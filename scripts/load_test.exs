Mix.install([
  {:req, "~> 0.5"},
  {:postgrex, "~> 0.19"}
])

defmodule LoadTest do
  @base_url  System.get_env("SERVICE_URL",   "http://localhost:8080")
  @admin_tok System.get_env("ADMIN_TOKEN",   "secret")
  @tenants   String.to_integer(System.get_env("TENANTS",  "5"))
  @rps       String.to_integer(System.get_env("RPS",      "3"))
  @pg_host   System.get_env("PG_HOST",       "127.0.0.1")
  @pg_port   String.to_integer(System.get_env("PG_PORT",  "5432"))
  @report_every_s 10

  def admin(method, path, body \\ nil) do
    opts = [headers: [{"Authorization", "Bearer #{@admin_tok}"}], retry: false]
    url  = "#{@base_url}#{path}"
    case method do
      :get    -> Req.get!(url, opts)
      :post   -> Req.post!(url, Keyword.merge(opts, [json: body]))
      :delete -> Req.delete!(url, opts)
    end
  end

  def ensure_running(slug) do
    case admin(:get, "/admin/tenants/#{slug}").body["state"] do
      "running" -> :ok
      _ ->
        admin(:post, "/admin/tenants/#{slug}/wake")
        wait_running(slug, 30)
    end
  end

  defp wait_running(slug, 0), do: raise "#{slug} did not start"
  defp wait_running(slug, n) do
    Process.sleep(1000)
    if admin(:get, "/admin/tenants/#{slug}").body["state"] == "running",
      do: :ok, else: wait_running(slug, n - 1)
  end

  def setup_tenant(slug) do
    case admin(:get, "/admin/tenants/#{slug}").status do
      200 -> admin(:delete, "/admin/tenants/#{slug}")
      _ -> :ok
    end
    resp = admin(:post, "/admin/tenants", %{slug: slug})
    {token, password, info} = {resp.body["token"], resp.body["password"], resp.body["tenant"]}
    IO.puts("  #{String.pad_trailing(slug, 12)}  pg=#{info["pgUrl"]}")
    conn = connect_postgrex(slug, password)
    setup_schema(conn, slug)
    {slug, token, password, conn}
  end

  def connect_postgrex(username, password \\ "", retries \\ 5) do
    case Postgrex.start_link(hostname: @pg_host, port: @pg_port, username: username,
           database: "postgres", password: password || "", ssl: false, pool_size: 4,
           queue_target: 15_000, queue_interval: 15_000) do
      {:ok, conn} -> conn
      {:error, _} when retries > 0 ->
        Process.sleep(1000); connect_postgrex(username, password, retries - 1)
      {:error, e} -> raise e
    end
  end

  def setup_schema(conn, slug) do
    Postgrex.query!(conn, """
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, slug TEXT NOT NULL,
        email TEXT NOT NULL, name TEXT NOT NULL,
        score INTEGER DEFAULT 0, active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    """, [])
    Postgrex.query!(conn, """
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        slug TEXT NOT NULL, kind TEXT NOT NULL,
        payload TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
      )
    """, [])
    Postgrex.query!(conn, """
      CREATE INDEX IF NOT EXISTS events_user_idx ON events(user_id);
      CREATE INDEX IF NOT EXISTS events_slug_kind_idx ON events(slug, kind);
    """, [])
    for i <- 1..50 do
      Postgrex.query!(conn,
        "INSERT INTO users (slug,email,name,score) VALUES ($1,$2,$3,$4)",
        [slug, "u#{i}@#{slug}.test", "User #{i}", Integer.to_string(:rand.uniform(1000))])
    end
    for i <- 1..200 do
      Postgrex.query!(conn,
        "INSERT INTO events (user_id,slug,kind,payload) VALUES ($1,$2,$3,$4)",
        [Integer.to_string(:rand.uniform(50)), slug,
         Enum.random(["click","view","purchase","login"]),
         ~s({"i":#{i}})])
    end
    IO.puts("  #{String.pad_trailing(slug, 12)}  schema + seed ready")
  end

  # Build a bulk INSERT of N rows as a single VALUES clause
  defp bulk_values(slug, n) do
    rows = for i <- 1..n do
      uid = Integer.to_string(:rand.uniform(50))
      kind = Enum.random(["click","view","purchase","login","scroll"])
      payload = ~s({"seq":#{i},"v":"#{:crypto.strong_rand_bytes(8) |> Base.encode16()}"})
      "(#{uid},'#{slug}','#{kind}','#{payload}')"
    end
    Enum.join(rows, ",")
  end

  def ops(conn, slug, token) do
    [
      # Large bulk insert — 100 rows at once
      fn ->
        values = bulk_values(slug, 100)
        Postgrex.query!(conn,
          "INSERT INTO events (user_id,slug,kind,payload) VALUES #{values}", [])
        :bulk_100
      end,

      # Medium bulk insert — 25 rows at once
      fn ->
        values = bulk_values(slug, 25)
        Postgrex.query!(conn,
          "INSERT INTO events (user_id,slug,kind,payload) VALUES #{values}", [])
        :bulk_25
      end,

      # JOIN aggregation with ordering
      fn ->
        Postgrex.query!(conn, """
          SELECT u.id, u.name, u.score, COUNT(e.id) AS events
          FROM users u
          LEFT JOIN events e ON e.user_id = u.id AND e.slug = $1
          WHERE u.slug = $1
          GROUP BY u.id ORDER BY events DESC LIMIT 10
        """, [slug])
        :join_agg
      end,

      # Window function — running total across event kinds
      fn ->
        Postgrex.query!(conn, """
          SELECT kind, COUNT(*) cnt,
                 SUM(COUNT(*)) OVER (ORDER BY COUNT(*) DESC) running_total,
                 ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) pct
          FROM events WHERE slug = $1 GROUP BY kind ORDER BY cnt DESC
        """, [slug])
        :window_pct
      end,

      # CTE: top users by recent activity
      fn ->
        Postgrex.query!(conn, """
          WITH recent AS (
            SELECT user_id, COUNT(*) cnt
            FROM events WHERE slug = $1
              AND created_at > now() - INTERVAL '1 hour'
            GROUP BY user_id
          ),
          ranked AS (
            SELECT u.id, u.name, u.score, COALESCE(r.cnt, 0) recent_events,
                   RANK() OVER (ORDER BY COALESCE(r.cnt, 0) DESC) rnk
            FROM users u LEFT JOIN recent r ON r.user_id = u.id
            WHERE u.slug = $1
          )
          SELECT * FROM ranked WHERE rnk <= 5
        """, [slug])
        :cte_recent
      end,

      # Correlated subqueries — purchase funnel per user
      fn ->
        Postgrex.query!(conn, """
          SELECT u.id, u.name,
            (SELECT COUNT(*) FROM events e WHERE e.user_id=u.id AND e.kind='view') views,
            (SELECT COUNT(*) FROM events e WHERE e.user_id=u.id AND e.kind='purchase') purchases
          FROM users u WHERE u.slug=$1 ORDER BY purchases DESC LIMIT 15
        """, [slug])
        :funnel
      end,

      # Heavy aggregation — stats per kind with percentiles approximated via ORDER BY
      fn ->
        Postgrex.query!(conn, """
          SELECT kind,
            COUNT(*) total,
            MIN(created_at) first_at,
            MAX(created_at) last_at,
            COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '1 hour') last_hour
          FROM events WHERE slug=$1
          GROUP BY kind HAVING COUNT(*) > 0 ORDER BY total DESC
        """, [slug])
        :heavy_agg
      end,

      # UPDATE: boost score of most active users
      fn ->
        Postgrex.query!(conn, """
          UPDATE users SET score = score + 5
          WHERE slug=$1 AND id IN (
            SELECT user_id FROM events WHERE slug=$1
            GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 5
          )
        """, [slug])
        :update_top
      end,

      # DELETE old events in cycles (keeps table size bounded)
      fn ->
        Postgrex.query!(conn, """
          DELETE FROM events WHERE slug=$1 AND id IN (
            SELECT id FROM events WHERE slug=$1
            ORDER BY created_at ASC LIMIT 50
          )
        """, [slug])
        :prune_old
      end,

      # HTTP REST auth signup
      fn ->
        Req.post!("#{@base_url}/#{slug}/auth/v1/signup",
          headers: [{"Authorization", "Bearer #{token}"}],
          json: %{email: "u#{:rand.uniform(99999)}@#{slug}.test", password: "pw123456"},
          retry: false)
        :http_auth
      end,
    ]
  end

  # Per-tenant worker: runs indefinitely, sends stats every @report_every_s seconds
  def run_worker(slug, token, password, stats_pid) do
    conn = connect_postgrex(slug, password)
    all_ops = ops(conn, slug, token)
    interval_ms = div(1000, @rps)
    ok  = :counters.new(1, [:atomics])
    err = :counters.new(1, [:atomics])

    # Reporter: sends accumulated counts to stats_pid periodically
    spawn(fn ->
      Stream.repeatedly(fn ->
        Process.sleep(@report_every_s * 1000)
        o = :counters.get(ok, 1); e = :counters.get(err, 1)
        :counters.put(ok, 1, 0); :counters.put(err, 1, 0)
        send(stats_pid, {:report, slug, o, e})
      end) |> Stream.run()
    end)

    Stream.repeatedly(fn ->
      t0 = System.monotonic_time(:millisecond)
      try do
        Enum.random(all_ops).()
        :counters.add(ok, 1, 1)
      rescue
        _ -> :counters.add(err, 1, 1)
      end
      elapsed = System.monotonic_time(:millisecond) - t0
      if elapsed < interval_ms, do: Process.sleep(interval_ms - elapsed)
    end) |> Stream.run()
  end

  def print_usage do
    resp = admin(:get, "/admin/usage")
    active = resp.body["tenants"] |> Enum.filter(& &1["requests"] > 0)
    IO.puts("\e[2J\e[H╔══ Service Usage (#{DateTime.utc_now() |> Calendar.strftime("%H:%M:%S")}) ══╗")
    IO.puts("  #{pad("slug",14)} #{pad("state",9)} #{lpad("reqs",7)} #{lpad("avg ms",7)} #{lpad("out KB",7)}")
    IO.puts("  " <> String.duplicate("─", 52))
    Enum.each(active, fn t ->
      IO.puts("  #{pad(t["slug"],14)} #{pad(t["state"],9)} " <>
              "#{lpad(t["requests"],7)} #{lpad(t["avgLatencyMs"],7)} " <>
              "#{lpad(div(t["bytesOut"],1024),7)}")
    end)
    tot = resp.body["totals"]
    IO.puts("  " <> String.duplicate("─", 52))
    IO.puts("  #{pad("TOTAL",14)} #{pad("",9)} #{lpad(tot["requests"],7)} #{lpad(tot["avgLatencyMs"],7)}")
  end

  defp pad(v, n), do: to_string(v) |> String.pad_trailing(n)
  defp lpad(v, n), do: to_string(v) |> String.pad_leading(n)

  # Stats aggregator — waits for one report per tenant per epoch
  def stats_loop(tenants, epoch \\ 1) do
    reports = Enum.map(tenants, fn {slug, _, _, _} ->
      receive do
        {:report, ^slug, ok, err} -> {slug, ok, err}
      after (@report_every_s + 5) * 1000 -> {slug, 0, 0}
      end
    end)

    epoch_ok  = Enum.sum(for {_,ok,_}  <- reports, do: ok)
    epoch_err = Enum.sum(for {_,_,err} <- reports, do: err)
    throughput = Float.round(epoch_ok / @report_every_s, 1)

    IO.puts("\n╔══ Epoch #{epoch} (last #{@report_every_s}s) ══╗")
    IO.puts("  ok=#{epoch_ok}  err=#{epoch_err}  throughput=#{throughput} req/s")
    print_usage()

    stats_loop(tenants, epoch + 1)
  end

  def run do
    IO.puts("""
    ╔══════════════════════════════════════════════╗
    ║     nano-supabase continuous load test       ║
    ╠══════════════════════════════════════════════╣
    ║  url         : #{pad(@base_url, 27)}║
    ║  pg          : #{pad("#{@pg_host}:#{@pg_port}", 27)}║
    ║  tenants     : #{pad(@tenants, 27)}║
    ║  rps/tenant  : #{pad(@rps, 27)}║
    ║  report every: #{pad("#{@report_every_s}s", 27)}║
    ║  mode        : #{pad("continuous (Ctrl+C to stop)", 27)}║
    ╚══════════════════════════════════════════════╝

    ops: bulk_100, bulk_25, join_agg, window_pct,
         cte_recent, funnel, heavy_agg, update_top,
         prune_old (keeps table bounded), http_auth
    """)

    IO.puts("Setting up #{@tenants} tenants...\n")
    tenants = Enum.map(1..@tenants, fn i -> setup_tenant("load#{i}") end)
    IO.puts("\nAll tenants ready. Continuous load started...\n")

    stats_pid = self()
    Enum.each(tenants, fn {slug, token, password, _} ->
      spawn(fn -> run_worker(slug, token, password, stats_pid) end)
    end)

    stats_loop(tenants)
  end
end

LoadTest.run()
