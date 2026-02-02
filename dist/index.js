var L=class n{static __wrap(e){e=e>>>0;let t=Object.create(n.prototype);return t.__wbg_ptr=e,Ne.register(t,t.__wbg_ptr,t),t}__destroy_into_raw(){let e=this.__wbg_ptr;return this.__wbg_ptr=0,Ne.unregister(this),e}free(){let e=this.__destroy_into_raw();u.__wbg_wasmqueryresult_free(e,0)}get params(){let e=u.wasmqueryresult_params(this.__wbg_ptr);return R(e)}get query(){let e,t;try{let i=u.__wbindgen_add_to_stack_pointer(-16);u.wasmqueryresult_query(i,this.__wbg_ptr);var r=E().getInt32(i+4*0,!0),s=E().getInt32(i+4*1,!0);return e=r,t=s,$(r,s)}finally{u.__wbindgen_add_to_stack_pointer(16),u.__wbindgen_export4(e,t,1)}}get tables(){let e=u.wasmqueryresult_tables(this.__wbg_ptr);return R(e)}toJSON(){let e=u.wasmqueryresult_toJSON(this.__wbg_ptr);return R(e)}};Symbol.dispose&&(L.prototype[Symbol.dispose]=L.prototype.free);function Ue(n){try{let s=u.__wbindgen_add_to_stack_pointer(-16);u.buildFilterClause(s,f(n));var e=E().getInt32(s+4*0,!0),t=E().getInt32(s+4*1,!0),r=E().getInt32(s+4*2,!0);if(r)throw R(t);return R(e)}finally{u.__wbindgen_add_to_stack_pointer(16)}}function fe(n){let e=u.initSchemaFromDb(f(n));return R(e)}function Ie(n,e,t){try{let c=u.__wbindgen_add_to_stack_pointer(-16),_=y(n,u.__wbindgen_export,u.__wbindgen_export2),p=h,d=y(e,u.__wbindgen_export,u.__wbindgen_export2),g=h;var r=m(t)?0:y(t,u.__wbindgen_export,u.__wbindgen_export2),s=h;u.parseDelete(c,_,p,d,g,r,s);var i=E().getInt32(c+4*0,!0),a=E().getInt32(c+4*1,!0),o=E().getInt32(c+4*2,!0);if(o)throw R(a);return L.__wrap(i)}finally{u.__wbindgen_add_to_stack_pointer(16)}}function Le(n,e,t,r){try{let d=u.__wbindgen_add_to_stack_pointer(-16),g=y(n,u.__wbindgen_export,u.__wbindgen_export2),T=h,w=y(e,u.__wbindgen_export,u.__wbindgen_export2),S=h;var s=m(t)?0:y(t,u.__wbindgen_export,u.__wbindgen_export2),i=h,a=m(r)?0:y(r,u.__wbindgen_export,u.__wbindgen_export2),o=h;u.parseInsert(d,g,T,w,S,s,i,a,o);var c=E().getInt32(d+4*0,!0),_=E().getInt32(d+4*1,!0),p=E().getInt32(d+4*2,!0);if(p)throw R(_);return L.__wrap(c)}finally{u.__wbindgen_add_to_stack_pointer(16)}}function Ce(n){try{let s=u.__wbindgen_add_to_stack_pointer(-16),i=y(n,u.__wbindgen_export,u.__wbindgen_export2),a=h;u.parseOnly(s,i,a);var e=E().getInt32(s+4*0,!0),t=E().getInt32(s+4*1,!0),r=E().getInt32(s+4*2,!0);if(r)throw R(t);return R(e)}finally{u.__wbindgen_add_to_stack_pointer(16)}}function Z(n,e,t,r,s){try{let g=u.__wbindgen_add_to_stack_pointer(-16),T=y(n,u.__wbindgen_export,u.__wbindgen_export2),w=h,S=y(e,u.__wbindgen_export,u.__wbindgen_export2),z=h,_e=y(t,u.__wbindgen_export,u.__wbindgen_export2),U=h;var i=m(r)?0:y(r,u.__wbindgen_export,u.__wbindgen_export2),a=h,o=m(s)?0:y(s,u.__wbindgen_export,u.__wbindgen_export2),c=h;u.parseRequest(g,T,w,S,z,_e,U,i,a,o,c);var _=E().getInt32(g+4*0,!0),p=E().getInt32(g+4*1,!0),d=E().getInt32(g+4*2,!0);if(d)throw R(p);return L.__wrap(_)}finally{u.__wbindgen_add_to_stack_pointer(16)}}function ve(n,e,t,r){try{let T=u.__wbindgen_add_to_stack_pointer(-16),w=y(n,u.__wbindgen_export,u.__wbindgen_export2),S=h;var s=m(e)?0:y(e,u.__wbindgen_export,u.__wbindgen_export2),i=h,a=m(t)?0:y(t,u.__wbindgen_export,u.__wbindgen_export2),o=h,c=m(r)?0:y(r,u.__wbindgen_export,u.__wbindgen_export2),_=h;u.parseRpc(T,w,S,s,i,a,o,c,_);var p=E().getInt32(T+4*0,!0),d=E().getInt32(T+4*1,!0),g=E().getInt32(T+4*2,!0);if(g)throw R(d);return L.__wrap(p)}finally{u.__wbindgen_add_to_stack_pointer(16)}}function Oe(n,e,t,r){try{let _=u.__wbindgen_add_to_stack_pointer(-16),p=y(n,u.__wbindgen_export,u.__wbindgen_export2),d=h,g=y(e,u.__wbindgen_export,u.__wbindgen_export2),T=h,w=y(t,u.__wbindgen_export,u.__wbindgen_export2),S=h;var s=m(r)?0:y(r,u.__wbindgen_export,u.__wbindgen_export2),i=h;u.parseUpdate(_,p,d,g,T,w,S,s,i);var a=E().getInt32(_+4*0,!0),o=E().getInt32(_+4*1,!0),c=E().getInt32(_+4*2,!0);if(c)throw R(o);return L.__wrap(a)}finally{u.__wbindgen_add_to_stack_pointer(16)}}function Me(){return{__proto__:null,"./postgrest_parser_bg.js":{__proto__:null,__wbg_Error_8c4e43fe74559d73:function(e,t){let r=Error($(e,t));return f(r)},__wbg_Number_04624de7d0e8332d:function(e){return Number(l(e))},__wbg_String_8f0eb39a4a4c2f66:function(e,t){let r=String(l(t)),s=y(r,u.__wbindgen_export,u.__wbindgen_export2),i=h;E().setInt32(e+4,i,!0),E().setInt32(e+0,s,!0)},__wbg___wbindgen_bigint_get_as_i64_8fcf4ce7f1ca72a2:function(e,t){let r=l(t),s=typeof r=="bigint"?r:void 0;E().setBigInt64(e+8,m(s)?BigInt(0):s,!0),E().setInt32(e+0,!m(s),!0)},__wbg___wbindgen_boolean_get_bbbb1c18aa2f5e25:function(e){let t=l(e),r=typeof t=="boolean"?t:void 0;return m(r)?16777215:r?1:0},__wbg___wbindgen_debug_string_0bc8482c6e3508ae:function(e,t){let r=pe(l(t)),s=y(r,u.__wbindgen_export,u.__wbindgen_export2),i=h;E().setInt32(e+4,i,!0),E().setInt32(e+0,s,!0)},__wbg___wbindgen_in_47fa6863be6f2f25:function(e,t){return l(e)in l(t)},__wbg___wbindgen_is_bigint_31b12575b56f32fc:function(e){return typeof l(e)=="bigint"},__wbg___wbindgen_is_function_0095a73b8b156f76:function(e){return typeof l(e)=="function"},__wbg___wbindgen_is_object_5ae8e5880f2c1fbd:function(e){let t=l(e);return typeof t=="object"&&t!==null},__wbg___wbindgen_is_string_cd444516edc5b180:function(e){return typeof l(e)=="string"},__wbg___wbindgen_is_undefined_9e4d92534c42d778:function(e){return l(e)===void 0},__wbg___wbindgen_jsval_eq_11888390b0186270:function(e,t){return l(e)===l(t)},__wbg___wbindgen_jsval_loose_eq_9dd77d8cd6671811:function(e,t){return l(e)==l(t)},__wbg___wbindgen_number_get_8ff4255516ccad3e:function(e,t){let r=l(t),s=typeof r=="number"?r:void 0;E().setFloat64(e+8,m(s)?0:s,!0),E().setInt32(e+0,!m(s),!0)},__wbg___wbindgen_string_get_72fb696202c56729:function(e,t){let r=l(t),s=typeof r=="string"?r:void 0;var i=m(s)?0:y(s,u.__wbindgen_export,u.__wbindgen_export2),a=h;E().setInt32(e+4,a,!0),E().setInt32(e+0,i,!0)},__wbg___wbindgen_throw_be289d5034ed271b:function(e,t){throw new Error($(e,t))},__wbg__wbg_cb_unref_d9b87ff7982e3b21:function(e){l(e)._wbg_cb_unref()},__wbg_call_389efe28435a9388:function(){return V(function(e,t){let r=l(e).call(l(t));return f(r)},arguments)},__wbg_call_4708e0c13bdc8e95:function(){return V(function(e,t,r){let s=l(e).call(l(t),l(r));return f(s)},arguments)},__wbg_done_57b39ecd9addfe81:function(e){return l(e).done},__wbg_entries_58c7934c745daac7:function(e){let t=Object.entries(l(e));return f(t)},__wbg_error_7534b8e9a36f1ab4:function(e,t){let r,s;try{r=e,s=t,console.error($(e,t))}finally{u.__wbindgen_export4(r,s,1)}},__wbg_get_9b94d73e6221f75c:function(e,t){let r=l(e)[t>>>0];return f(r)},__wbg_get_b3ed3ad4be2bc8ac:function(){return V(function(e,t){let r=Reflect.get(l(e),l(t));return f(r)},arguments)},__wbg_get_with_ref_key_1dc361bd10053bfe:function(e,t){let r=l(e)[l(t)];return f(r)},__wbg_instanceof_ArrayBuffer_c367199e2fa2aa04:function(e){let t;try{t=l(e)instanceof ArrayBuffer}catch{t=!1}return t},__wbg_instanceof_Map_53af74335dec57f4:function(e){let t;try{t=l(e)instanceof Map}catch{t=!1}return t},__wbg_instanceof_Uint8Array_9b9075935c74707c:function(e){let t;try{t=l(e)instanceof Uint8Array}catch{t=!1}return t},__wbg_isArray_d314bb98fcf08331:function(e){return Array.isArray(l(e))},__wbg_isSafeInteger_bfbc7332a9768d2a:function(e){return Number.isSafeInteger(l(e))},__wbg_iterator_6ff6560ca1568e55:function(){return f(Symbol.iterator)},__wbg_length_32ed9a279acd054c:function(e){return l(e).length},__wbg_length_35a7bace40f36eac:function(e){return l(e).length},__wbg_log_6b5ca2e6124b2808:function(e){console.log(l(e))},__wbg_new_361308b2356cecd0:function(){let e=new Object;return f(e)},__wbg_new_3eb36ae241fe6f44:function(){let e=new Array;return f(e)},__wbg_new_8a6f238a6ece86ea:function(){let e=new Error;return f(e)},__wbg_new_b5d9e2fb389fef91:function(e,t){try{var r={a:e,b:t},s=(a,o)=>{let c=r.a;r.a=0;try{return qe(c,r.b,a,o)}finally{r.a=c}};let i=new Promise(s);return f(i)}finally{r.a=r.b=0}},__wbg_new_dca287b076112a51:function(){return f(new Map)},__wbg_new_dd2b680c8bf6ae29:function(e){let t=new Uint8Array(l(e));return f(t)},__wbg_new_no_args_1c7c842f08d00ebb:function(e,t){let r=new Function($(e,t));return f(r)},__wbg_next_3482f54c49e8af19:function(){return V(function(e){let t=l(e).next();return f(t)},arguments)},__wbg_next_418f80d8f5303233:function(e){let t=l(e).next;return f(t)},__wbg_prototypesetcall_bdcdcc5842e4d77d:function(e,t,r){Uint8Array.prototype.set.call(Xe(e,t),l(r))},__wbg_queueMicrotask_0aa0a927f78f5d98:function(e){let t=l(e).queueMicrotask;return f(t)},__wbg_queueMicrotask_5bb536982f78a56f:function(e){queueMicrotask(l(e))},__wbg_resolve_002c4b7d9d8f6b64:function(e){let t=Promise.resolve(l(e));return f(t)},__wbg_set_1eb0999cf5d27fc8:function(e,t,r){let s=l(e).set(l(t),l(r));return f(s)},__wbg_set_3f1d0b984ed272ed:function(e,t,r){l(e)[R(t)]=R(r)},__wbg_set_f43e577aea94465b:function(e,t,r){l(e)[t>>>0]=R(r)},__wbg_stack_0ed75d68575b0f3c:function(e,t){let r=l(t).stack,s=y(r,u.__wbindgen_export,u.__wbindgen_export2),i=h;E().setInt32(e+4,i,!0),E().setInt32(e+0,s,!0)},__wbg_static_accessor_GLOBAL_12837167ad935116:function(){let e=typeof global>"u"?null:global;return m(e)?0:f(e)},__wbg_static_accessor_GLOBAL_THIS_e628e89ab3b1c95f:function(){let e=typeof globalThis>"u"?null:globalThis;return m(e)?0:f(e)},__wbg_static_accessor_SELF_a621d3dfbb60d0ce:function(){let e=typeof self>"u"?null:self;return m(e)?0:f(e)},__wbg_static_accessor_WINDOW_f8727f0cf888e0bd:function(){let e=typeof window>"u"?null:window;return m(e)?0:f(e)},__wbg_then_0d9fe2c7b1857d32:function(e,t,r){let s=l(e).then(l(t),l(r));return f(s)},__wbg_then_b9e7b3b5f1a9e1b5:function(e,t){let r=l(e).then(l(t));return f(r)},__wbg_value_0546255b415e96c1:function(e){let t=l(e).value;return f(t)},__wbindgen_cast_0000000000000001:function(e,t){let r=We(e,t,u.__wasm_bindgen_func_elem_366,Qe);return f(r)},__wbindgen_cast_0000000000000002:function(e){return f(e)},__wbindgen_cast_0000000000000003:function(e){return f(e)},__wbindgen_cast_0000000000000004:function(e,t){let r=$(e,t);return f(r)},__wbindgen_cast_0000000000000005:function(e){let t=BigInt.asUintN(64,e);return f(t)},__wbindgen_object_clone_ref:function(e){let t=l(e);return f(t)},__wbindgen_object_drop_ref:function(e){R(e)}}}}function Qe(n,e,t){u.__wasm_bindgen_func_elem_367(n,e,f(t))}function qe(n,e,t,r){u.__wasm_bindgen_func_elem_442(n,e,f(t),f(r))}var Ne=typeof FinalizationRegistry>"u"?{register:()=>{},unregister:()=>{}}:new FinalizationRegistry(n=>u.__wbg_wasmqueryresult_free(n>>>0,1));function f(n){X===I.length&&I.push(I.length+1);let e=X;return X=I[e],I[e]=n,e}var Se=typeof FinalizationRegistry>"u"?{register:()=>{},unregister:()=>{}}:new FinalizationRegistry(n=>n.dtor(n.a,n.b));function pe(n){let e=typeof n;if(e=="number"||e=="boolean"||n==null)return`${n}`;if(e=="string")return`"${n}"`;if(e=="symbol"){let s=n.description;return s==null?"Symbol":`Symbol(${s})`}if(e=="function"){let s=n.name;return typeof s=="string"&&s.length>0?`Function(${s})`:"Function"}if(Array.isArray(n)){let s=n.length,i="[";s>0&&(i+=pe(n[0]));for(let a=1;a<s;a++)i+=", "+pe(n[a]);return i+="]",i}let t=/\[object ([^\]]+)\]/.exec(toString.call(n)),r;if(t&&t.length>1)r=t[1];else return toString.call(n);if(r=="Object")try{return"Object("+JSON.stringify(n)+")"}catch{return"Object"}return n instanceof Error?`${n.name}: ${n.message}
${n.stack}`:r}function He(n){n<132||(I[n]=X,X=n)}function Xe(n,e){return n=n>>>0,H().subarray(n/1,n/1+e)}var O=null;function E(){return(O===null||O.buffer.detached===!0||O.buffer.detached===void 0&&O.buffer!==u.memory.buffer)&&(O=new DataView(u.memory.buffer)),O}function $(n,e){return n=n>>>0,Je(n,e)}var q=null;function H(){return(q===null||q.byteLength===0)&&(q=new Uint8Array(u.memory.buffer)),q}function l(n){return I[n]}function V(n,e){try{return n.apply(this,e)}catch(t){u.__wbindgen_export3(f(t))}}var I=new Array(128).fill(void 0);I.push(void 0,null,!0,!1);var X=I.length;function m(n){return n==null}function We(n,e,t,r){let s={a:n,b:e,cnt:1,dtor:t},i=(...a)=>{s.cnt++;let o=s.a;s.a=0;try{return r(o,s.b,...a)}finally{s.a=o,i._wbg_cb_unref()}};return i._wbg_cb_unref=()=>{--s.cnt===0&&(s.dtor(s.a,s.b),s.a=0,Se.unregister(s))},Se.register(i,s,s),i}function y(n,e,t){if(t===void 0){let o=W.encode(n),c=e(o.length,1)>>>0;return H().subarray(c,c+o.length).set(o),h=o.length,c}let r=n.length,s=e(r,1)>>>0,i=H(),a=0;for(;a<r;a++){let o=n.charCodeAt(a);if(o>127)break;i[s+a]=o}if(a!==r){a!==0&&(n=n.slice(a)),s=t(s,r,r=a+n.length*3,1)>>>0;let o=H().subarray(s+a,s+r),c=W.encodeInto(n,o);a+=c.written,s=t(s,r,a,1)>>>0}return h=a,s}function R(n){let e=l(n);return He(n),e}var Y=new TextDecoder("utf-8",{ignoreBOM:!0,fatal:!0});Y.decode();var je=2146435072,de=0;function Je(n,e){return de+=e,de>=je&&(Y=new TextDecoder("utf-8",{ignoreBOM:!0,fatal:!0}),Y.decode(),de=e),Y.decode(H().subarray(n,n+e))}var W=new TextEncoder;"encodeInto"in W||(W.encodeInto=function(n,e){let t=W.encode(n);return e.set(t),{read:n.length,written:t.length}});var h=0,ze,u;function Ve(n,e){return u=n.exports,ze=e,O=null,q=null,u.__wbindgen_start(),u}async function Ye(n,e){if(typeof Response=="function"&&n instanceof Response){if(typeof WebAssembly.instantiateStreaming=="function")try{return await WebAssembly.instantiateStreaming(n,e)}catch(s){if(n.ok&&t(n.type)&&n.headers.get("Content-Type")!=="application/wasm")console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n",s);else throw s}let r=await n.arrayBuffer();return await WebAssembly.instantiate(r,e)}else{let r=await WebAssembly.instantiate(n,e);return r instanceof WebAssembly.Instance?{instance:r,module:n}:r}function t(r){switch(r){case"basic":case"cors":case"default":return!0}return!1}}async function ge(n){if(u!==void 0)return u;n!==void 0&&(Object.getPrototypeOf(n)===Object.prototype?{module_or_path:n}=n:console.warn("using deprecated parameters for the initialization function; pass a single object instead")),n===void 0&&(n=new URL("postgrest_parser_bg.wasm",import.meta.url));let e=Me();(typeof n=="string"||typeof Request=="function"&&n instanceof Request||typeof URL=="function"&&n instanceof URL)&&(n=fetch(n));let{instance:t,module:r}=await Ye(await n,e);return Ve(t,r)}function k(n){return{query:n.query,params:n.params,tables:n.tables}}function G(n){return n?JSON.stringify(n):void 0}function K(n){if(!n)return;let e=[];return n.return&&e.push(`return=${n.return}`),n.resolution&&e.push(`resolution=${n.resolution}`),n.missing&&e.push(`missing=${n.missing}`),n.count&&e.push(`count=${n.count}`),e.length>0?e.join(","):void 0}function B(n,e){let t=[];if(n)for(let[r,s]of Object.entries(n))t.push(`${r}=${s}`);if(e?.select){let r=Array.isArray(e.select)?e.select.join(","):e.select;t.push(`select=${r}`)}if(e?.order){let r=Array.isArray(e.order)?e.order.join(","):e.order;t.push(`order=${r}`)}if(e?.limit!==void 0&&t.push(`limit=${e.limit}`),e?.offset!==void 0&&t.push(`offset=${e.offset}`),e?.onConflict){let r=Array.isArray(e.onConflict)?e.onConflict.join(","):e.onConflict;t.push(`on_conflict=${r}`)}if(e?.returning){let r=Array.isArray(e.returning)?e.returning.join(","):e.returning;t.push(`returning=${r}`)}return t.join("&")}var Ee=class{parseRequest(e,t,r,s,i){let a=s?JSON.stringify(s):void 0,o=i?G(i):void 0,c=Z(e,t,r,a,o);return k(c)}select(e,t={}){let r=B(t.filters,t),s=t.count?{Prefer:`count=${t.count}`}:void 0,i=Z("GET",e,r,void 0,G(s));return k(i)}insert(e,t,r={}){let s=B(void 0,{onConflict:r.onConflict,returning:r.returning}),i=K(r.prefer),a=i?{Prefer:i}:void 0,o=Le(e,JSON.stringify(t),s||void 0,G(a));return k(o)}upsert(e,t,r,s={}){let i={};for(let p of r)p in t&&(i[p]=`eq.${t[p]}`);let a=B(i,{returning:s.returning}),o=K(s.prefer),c=o?{Prefer:o}:void 0,_=Z("PUT",e,a,JSON.stringify(t),G(c));return k(_)}update(e,t,r,s={}){let i=B(r,{returning:s.returning}),a=K(s.prefer),o=a?{Prefer:a}:void 0,c=Oe(e,JSON.stringify(t),i,G(o));return k(c)}delete(e,t,r={}){let s=B(t,{returning:r.returning}),i=K(r.prefer),o=Ie(e,s,G(i?{Prefer:i}:void 0));return k(o)}rpc(e,t={},r={}){let s=B(r.filters,r),i=ve(e,JSON.stringify(t),s||void 0,void 0);return k(i)}parseOnly(e){return Ce(e)}buildFilterClause(e){return Ue(e)}};function ke(){return new Ee}var N=class n{client;static initPromise=null;constructor(){this.client=ke()}static async init(){n.initPromise||(n.initPromise=ge()),await n.initPromise}static async initSchema(e){await n.init(),await fe(e)}parseSelect(e,t=""){return this.parseRequest("GET",e,t)}parseInsert(e,t,r=""){return this.parseRequest("POST",e,r,t)}parseUpdate(e,t,r){return this.parseRequest("PATCH",e,r,t)}parseDelete(e,t){return this.parseRequest("DELETE",e,t)}parseRpc(e,t,r=""){let s=`rpc/${e}`;return this.parseRequest("POST",s,r,t)}parseRequest(e,t,r="",s){let i=this.client.parseRequest(e,t,r,s??null,null);return this.convertResult(i)}convertResult(e){return{sql:e.query,params:Array.isArray(e.params)?e.params:[],tables:Array.isArray(e.tables)?e.tables:[]}}};var te=`
-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create auth schema
CREATE SCHEMA IF NOT EXISTS auth;

-- Create PostgreSQL roles for RLS
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

-- Grant necessary permissions to roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Grant service_role full access to auth schema (needed for auth operations)
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO service_role;

-- Users table
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  aud VARCHAR(255) DEFAULT 'authenticated',
  role VARCHAR(255) DEFAULT 'authenticated',
  email VARCHAR(255) UNIQUE,
  encrypted_password VARCHAR(255),
  email_confirmed_at TIMESTAMPTZ,
  invited_at TIMESTAMPTZ,
  confirmation_token VARCHAR(255),
  confirmation_sent_at TIMESTAMPTZ,
  recovery_token VARCHAR(255),
  recovery_sent_at TIMESTAMPTZ,
  email_change_token_new VARCHAR(255),
  email_change VARCHAR(255),
  email_change_sent_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  is_super_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  phone VARCHAR(255) UNIQUE,
  phone_confirmed_at TIMESTAMPTZ,
  phone_change VARCHAR(255),
  phone_change_token VARCHAR(255),
  phone_change_sent_at TIMESTAMPTZ,
  email_change_token_current VARCHAR(255),
  email_change_confirm_status SMALLINT DEFAULT 0,
  banned_until TIMESTAMPTZ,
  reauthentication_token VARCHAR(255),
  reauthentication_sent_at TIMESTAMPTZ,
  is_sso_user BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  is_anonymous BOOLEAN DEFAULT FALSE
);

-- Sessions table
CREATE TABLE IF NOT EXISTS auth.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  factor_id UUID,
  aal VARCHAR(255) DEFAULT 'aal1',
  not_after TIMESTAMPTZ,
  refreshed_at TIMESTAMPTZ,
  user_agent TEXT,
  ip INET,
  tag TEXT
);

-- Refresh tokens table
CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  token VARCHAR(255) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  parent VARCHAR(255),
  session_id UUID REFERENCES auth.sessions(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS users_email_idx ON auth.users(email);
CREATE INDEX IF NOT EXISTS users_instance_id_idx ON auth.users(instance_id);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON auth.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_not_after_idx ON auth.sessions(not_after);
CREATE INDEX IF NOT EXISTS refresh_tokens_token_idx ON auth.refresh_tokens(token);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON auth.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_session_id_idx ON auth.refresh_tokens(session_id);

-- Function to get current user ID (for RLS policies)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE SQL STABLE;

-- Function to get current user role (for RLS policies)
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '');
$$ LANGUAGE SQL STABLE;

-- Function to get current user email (for RLS policies)
CREATE OR REPLACE FUNCTION auth.email() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.email', true), '');
$$ LANGUAGE SQL STABLE;

-- Function to get JWT claims (for RLS policies)
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
$$ LANGUAGE SQL STABLE;

-- Function to hash a password using pgcrypto
CREATE OR REPLACE FUNCTION auth.hash_password(password TEXT) RETURNS TEXT AS $$
  SELECT crypt(password, gen_salt('bf', 10));
$$ LANGUAGE SQL;

-- Function to verify a password against a hash
CREATE OR REPLACE FUNCTION auth.verify_password(password TEXT, password_hash TEXT) RETURNS BOOLEAN AS $$
  SELECT password_hash = crypt(password, password_hash);
$$ LANGUAGE SQL;

-- Function to generate a secure random token
CREATE OR REPLACE FUNCTION auth.generate_token(length INT DEFAULT 32) RETURNS TEXT AS $$
  SELECT encode(gen_random_bytes(length), 'hex');
$$ LANGUAGE SQL;

-- Function to create a new user with hashed password
CREATE OR REPLACE FUNCTION auth.create_user(
  p_email TEXT,
  p_password TEXT,
  p_user_metadata JSONB DEFAULT '{}'::jsonb,
  p_app_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS auth.users AS $$
DECLARE
  v_user auth.users;
BEGIN
  INSERT INTO auth.users (
    email,
    encrypted_password,
    email_confirmed_at,
    raw_user_meta_data,
    raw_app_meta_data,
    created_at,
    updated_at
  ) VALUES (
    p_email,
    auth.hash_password(p_password),
    NOW(), -- Auto-confirm for local development
    p_user_metadata,
    p_app_metadata,
    NOW(),
    NOW()
  ) RETURNING * INTO v_user;

  RETURN v_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to verify user credentials and return user if valid
CREATE OR REPLACE FUNCTION auth.verify_user_credentials(
  p_email TEXT,
  p_password TEXT
) RETURNS auth.users AS $$
DECLARE
  v_user auth.users;
BEGIN
  SELECT * INTO v_user
  FROM auth.users
  WHERE email = p_email
    AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until < NOW());

  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT auth.verify_password(p_password, v_user.encrypted_password) THEN
    RETURN NULL;
  END IF;

  -- Update last sign in time
  UPDATE auth.users
  SET last_sign_in_at = NOW(), updated_at = NOW()
  WHERE id = v_user.id;

  RETURN v_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create a session for a user
CREATE OR REPLACE FUNCTION auth.create_session(
  p_user_id UUID,
  p_user_agent TEXT DEFAULT NULL,
  p_ip TEXT DEFAULT NULL
) RETURNS auth.sessions AS $$
DECLARE
  v_session auth.sessions;
BEGIN
  INSERT INTO auth.sessions (
    user_id,
    user_agent,
    ip,
    created_at,
    updated_at,
    refreshed_at
  ) VALUES (
    p_user_id,
    p_user_agent,
    p_ip::inet,
    NOW(),
    NOW(),
    NOW()
  ) RETURNING * INTO v_session;

  RETURN v_session;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create a refresh token for a session
CREATE OR REPLACE FUNCTION auth.create_refresh_token(
  p_user_id UUID,
  p_session_id UUID
) RETURNS auth.refresh_tokens AS $$
DECLARE
  v_refresh_token auth.refresh_tokens;
BEGIN
  INSERT INTO auth.refresh_tokens (
    token,
    user_id,
    session_id,
    created_at,
    updated_at
  ) VALUES (
    auth.generate_token(32),
    p_user_id,
    p_session_id,
    NOW(),
    NOW()
  ) RETURNING * INTO v_refresh_token;

  RETURN v_refresh_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to refresh a token (revoke old, create new)
CREATE OR REPLACE FUNCTION auth.refresh_token(
  p_refresh_token TEXT
) RETURNS TABLE(
  new_token TEXT,
  user_id UUID,
  session_id UUID
) AS $$
DECLARE
  v_old_token auth.refresh_tokens;
  v_new_token auth.refresh_tokens;
BEGIN
  -- Find and validate the old token
  SELECT * INTO v_old_token
  FROM auth.refresh_tokens rt
  WHERE rt.token = p_refresh_token
    AND rt.revoked = FALSE;

  IF v_old_token IS NULL THEN
    RETURN;
  END IF;

  -- Revoke the old token
  UPDATE auth.refresh_tokens
  SET revoked = TRUE, updated_at = NOW()
  WHERE id = v_old_token.id;

  -- Update session refreshed_at
  UPDATE auth.sessions
  SET refreshed_at = NOW(), updated_at = NOW()
  WHERE id = v_old_token.session_id;

  -- Create new token
  INSERT INTO auth.refresh_tokens (
    token,
    user_id,
    session_id,
    parent,
    created_at,
    updated_at
  ) VALUES (
    auth.generate_token(32),
    v_old_token.user_id,
    v_old_token.session_id,
    v_old_token.token,
    NOW(),
    NOW()
  ) RETURNING * INTO v_new_token;

  RETURN QUERY SELECT v_new_token.token, v_new_token.user_id, v_new_token.session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to revoke all sessions for a user (sign out)
CREATE OR REPLACE FUNCTION auth.sign_out(p_session_id UUID) RETURNS VOID AS $$
BEGIN
  -- Revoke all refresh tokens for this session
  UPDATE auth.refresh_tokens
  SET revoked = TRUE, updated_at = NOW()
  WHERE session_id = p_session_id;

  -- Delete the session
  DELETE FROM auth.sessions WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sign out all sessions for a user
CREATE OR REPLACE FUNCTION auth.sign_out_all(p_user_id UUID) RETURNS VOID AS $$
BEGIN
  -- Revoke all refresh tokens
  UPDATE auth.refresh_tokens
  SET revoked = TRUE, updated_at = NOW()
  WHERE user_id = p_user_id;

  -- Delete all sessions
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Config table for storing signing key
CREATE TABLE IF NOT EXISTS auth.config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Function to get or create the signing key
CREATE OR REPLACE FUNCTION auth.get_signing_key() RETURNS TEXT AS $$
DECLARE
  v_key TEXT;
BEGIN
  SELECT value INTO v_key FROM auth.config WHERE key = 'jwt_signing_key';

  IF v_key IS NULL THEN
    v_key := encode(gen_random_bytes(32), 'hex');
    INSERT INTO auth.config (key, value) VALUES ('jwt_signing_key', v_key);
  END IF;

  RETURN v_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to base64url encode
CREATE OR REPLACE FUNCTION auth.base64url_encode(data BYTEA) RETURNS TEXT AS $$
  SELECT replace(replace(rtrim(encode(data, 'base64'), '='), '+', '-'), '/', '_');
$$ LANGUAGE SQL IMMUTABLE;

-- Function to base64url decode
CREATE OR REPLACE FUNCTION auth.base64url_decode(data TEXT) RETURNS BYTEA AS $$
DECLARE
  v_padded TEXT;
  v_converted TEXT;
BEGIN
  v_converted := replace(replace(data, '-', '+'), '_', '/');
  v_padded := v_converted || repeat('=', (4 - length(v_converted) % 4) % 4);
  RETURN decode(v_padded, 'base64');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to create an access token (JWT-like structure using HMAC)
CREATE OR REPLACE FUNCTION auth.create_access_token(
  p_user_id UUID,
  p_session_id UUID,
  p_email TEXT,
  p_role TEXT DEFAULT 'authenticated',
  p_user_metadata JSONB DEFAULT '{}'::jsonb,
  p_app_metadata JSONB DEFAULT '{}'::jsonb,
  p_expires_in INT DEFAULT 3600
) RETURNS TEXT AS $$
DECLARE
  v_key TEXT;
  v_now BIGINT;
  v_exp BIGINT;
  v_header TEXT;
  v_payload TEXT;
  v_header_b64 TEXT;
  v_payload_b64 TEXT;
  v_signature_input TEXT;
  v_signature TEXT;
BEGIN
  v_key := auth.get_signing_key();
  v_now := EXTRACT(EPOCH FROM NOW())::BIGINT;
  v_exp := v_now + p_expires_in;

  -- Create header
  v_header := '{"alg":"HS256","typ":"JWT"}';
  v_header_b64 := auth.base64url_encode(v_header::bytea);

  -- Create payload
  v_payload := json_build_object(
    'sub', p_user_id,
    'aud', 'authenticated',
    'role', p_role,
    'email', p_email,
    'session_id', p_session_id,
    'iat', v_now,
    'exp', v_exp,
    'user_metadata', p_user_metadata,
    'app_metadata', p_app_metadata
  )::text;
  v_payload_b64 := auth.base64url_encode(v_payload::bytea);

  -- Create signature
  v_signature_input := v_header_b64 || '.' || v_payload_b64;
  v_signature := auth.base64url_encode(
    hmac(v_signature_input::bytea, decode(v_key, 'hex'), 'sha256')
  );

  RETURN v_signature_input || '.' || v_signature;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to verify an access token and return payload
CREATE OR REPLACE FUNCTION auth.verify_access_token(p_token TEXT) RETURNS TABLE(
  valid BOOLEAN,
  user_id UUID,
  session_id UUID,
  email TEXT,
  role TEXT,
  exp BIGINT,
  user_metadata JSONB,
  app_metadata JSONB,
  error TEXT
) AS $$
DECLARE
  v_parts TEXT[];
  v_header_b64 TEXT;
  v_payload_b64 TEXT;
  v_signature_b64 TEXT;
  v_key TEXT;
  v_signature_input TEXT;
  v_expected_sig TEXT;
  v_payload JSONB;
  v_now BIGINT;
BEGIN
  -- Split token into parts
  v_parts := string_to_array(p_token, '.');

  IF array_length(v_parts, 1) != 3 THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::JSONB, NULL::JSONB, 'Invalid token format'::TEXT;
    RETURN;
  END IF;

  v_header_b64 := v_parts[1];
  v_payload_b64 := v_parts[2];
  v_signature_b64 := v_parts[3];

  -- Verify signature
  v_key := auth.get_signing_key();
  v_signature_input := v_header_b64 || '.' || v_payload_b64;
  v_expected_sig := auth.base64url_encode(
    hmac(v_signature_input::bytea, decode(v_key, 'hex'), 'sha256')
  );

  IF v_signature_b64 != v_expected_sig THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::JSONB, NULL::JSONB, 'Invalid signature'::TEXT;
    RETURN;
  END IF;

  -- Decode payload
  BEGIN
    v_payload := convert_from(auth.base64url_decode(v_payload_b64), 'UTF8')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::JSONB, NULL::JSONB, 'Invalid payload'::TEXT;
    RETURN;
  END;

  -- Check expiration
  v_now := EXTRACT(EPOCH FROM NOW())::BIGINT;
  IF (v_payload->>'exp')::BIGINT < v_now THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::BIGINT, NULL::JSONB, NULL::JSONB, 'Token expired'::TEXT;
    RETURN;
  END IF;

  -- Return valid token data
  RETURN QUERY SELECT
    true,
    (v_payload->>'sub')::UUID,
    (v_payload->>'session_id')::UUID,
    v_payload->>'email',
    v_payload->>'role',
    (v_payload->>'exp')::BIGINT,
    COALESCE(v_payload->'user_metadata', '{}'::jsonb),
    COALESCE(v_payload->'app_metadata', '{}'::jsonb),
    NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions on auth schema functions to roles
-- This allows RLS policies and DEFAULT values to use these functions
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.email() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;

-- Grant execute on auth management functions
-- These have SECURITY DEFINER so they run with elevated privileges
GRANT EXECUTE ON FUNCTION auth.create_user(TEXT, TEXT, JSONB, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.verify_user_credentials(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.create_session(UUID, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.create_refresh_token(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.refresh_token(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.sign_out(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.sign_out_all(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.get_signing_key() TO service_role;
GRANT EXECUTE ON FUNCTION auth.create_access_token(UUID, UUID, TEXT, TEXT, JSONB, JSONB, INT) TO service_role;
GRANT EXECUTE ON FUNCTION auth.verify_access_token(TEXT) TO service_role;
`;function ee(n){return n.replace(/'/g,"''")}function re(n,e,t){let r=JSON.stringify({sub:n,role:e,email:t,aud:"authenticated"}),s=ee(n),i=ee(e),a=ee(t),o=ee(r);return`
    SET ROLE ${i};
    SELECT set_config('request.jwt.claim.sub', '${s}', false);
    SELECT set_config('request.jwt.claim.role', '${i}', false);
    SELECT set_config('request.jwt.claim.email', '${a}', false);
    SELECT set_config('request.jwt.claims', '${o}', false);
  `}var M=`
  SET ROLE anon;
  SELECT set_config('request.jwt.claim.sub', '', false);
  SELECT set_config('request.jwt.claim.role', 'anon', false);
  SELECT set_config('request.jwt.claim.email', '', false);
  SELECT set_config('request.jwt.claims', '{"role": "anon"}', false);
`;function Te(n){return btoa(String.fromCharCode(...n)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"")}function he(n){let e=n.replace(/-/g,"+").replace(/_/g,"/").padEnd(n.length+(4-n.length%4)%4,"="),t=atob(e),r=new Uint8Array(t.length);for(let s=0;s<t.length;s++)r[s]=t.charCodeAt(s);return r}var Q=new TextEncoder,xe=new TextDecoder;async function ye(n,e){let t={alg:"HS256",typ:"JWT"},r=Te(Q.encode(JSON.stringify(t))),s=Te(Q.encode(JSON.stringify(n))),i=`${r}.${s}`,a=await crypto.subtle.importKey("raw",Q.encode(e),{name:"HMAC",hash:"SHA-256"},!1,["sign"]),o=await crypto.subtle.sign("HMAC",a,Q.encode(i)),c=Te(new Uint8Array(o));return`${i}.${c}`}async function be(n,e){try{let t=n.split(".");if(t.length!==3)return{valid:!1,error:"Invalid token format"};let[r,s,i]=t;if(!r||!s||!i)return{valid:!1,error:"Invalid token format"};let a=`${r}.${s}`,o=await crypto.subtle.importKey("raw",Q.encode(e),{name:"HMAC",hash:"SHA-256"},!1,["verify"]),c=he(i);if(!await crypto.subtle.verify("HMAC",o,c,Q.encode(a)))return{valid:!1,error:"Invalid signature"};let p=xe.decode(he(s)),d=JSON.parse(p),g=Math.floor(Date.now()/1e3);return d.exp&&d.exp<g?{valid:!1,error:"Token expired"}:{valid:!0,payload:d}}catch(t){return{valid:!1,error:t instanceof Error?t.message:"Verification failed"}}}function ne(n){try{let e=n.split(".");if(e.length!==3)return null;let t=e[1];if(!t)return null;let r=xe.decode(he(t));return JSON.parse(r)}catch{return null}}var Pe=3600,j=null;async function Fe(n){if(j)return j;let e=await n.query("SELECT value FROM auth.config WHERE key = 'jwt_secret'");if(e.rows.length>0&&e.rows[0])return j=e.rows[0].value,j;let t=new Uint8Array(32);crypto.getRandomValues(t);let r=Array.from(t,s=>s.toString(16).padStart(2,"0")).join("");return await n.exec(`
    INSERT INTO auth.config (key, value)
    VALUES ('jwt_secret', '${r}')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `),j=r,r}async function x(n,e,t,r=Pe){let s=await Fe(n),i=Math.floor(Date.now()/1e3),a={sub:e.id,aud:"authenticated",role:e.role,email:e.email||void 0,session_id:t,iat:i,exp:i+r,user_metadata:e.user_metadata||{},app_metadata:e.app_metadata||{}};return ye(a,s)}async function C(n,e){let t=await Fe(n);return be(e,t)}async function De(n,e,t,r,s=Pe){let i=await x(n,e,t,s),a=Math.floor(Date.now()/1e3);return{accessToken:i,refreshToken:r,expiresIn:s,expiresAt:a+s}}function $e(n){return ne(n)?.sub||null}function se(n){return ne(n)?.session_id||null}var P=3600;function F(n){return{id:n.id,aud:n.aud,role:n.role,email:n.email,email_confirmed_at:n.email_confirmed_at||void 0,phone:n.phone||void 0,phone_confirmed_at:n.phone_confirmed_at||void 0,confirmed_at:n.email_confirmed_at||n.phone_confirmed_at||void 0,last_sign_in_at:n.last_sign_in_at||void 0,app_metadata:n.raw_app_meta_data||{},user_metadata:n.raw_user_meta_data||{},created_at:n.created_at,updated_at:n.updated_at}}function A(n,e,t){return{message:n,status:e,code:t}}var v=class{db;initialized=!1;subscriptions=new Map;currentSession=null;constructor(e){this.db=e}async initialize(){this.initialized||(await this.db.exec(te),this.initialized=!0)}emitAuthStateChange(e,t){this.currentSession=t;for(let r of this.subscriptions.values())try{r(e,t)}catch(s){console.error("Auth state change callback error:",s)}}onAuthStateChange(e){let t=crypto.randomUUID();return this.subscriptions.set(t,e),setTimeout(()=>{e("INITIAL_SESSION",this.currentSession)},0),{id:t,callback:e,unsubscribe:()=>{this.subscriptions.delete(t)}}}async signUp(e,t,r){await this.initialize(),await this.db.exec("RESET ROLE");try{if((await this.db.query("SELECT * FROM auth.users WHERE email = $1",[e])).rows.length>0)return{data:{user:null,session:null},error:A("User already registered",400,"user_already_exists")};let i=r?.data?JSON.stringify(r.data):"{}",a=await this.db.query("SELECT * FROM auth.create_user($1, $2, $3::jsonb)",[e,t,i]);if(a.rows.length===0)return{data:{user:null,session:null},error:A("Failed to create user",500,"user_creation_failed")};let o=a.rows[0];if(!o)return{data:{user:null,session:null},error:A("Failed to create user",500,"user_creation_failed")};let c=F(o),_=await this.createSession(o);return this.emitAuthStateChange("SIGNED_IN",_),{data:{user:c,session:_},error:null}}catch(s){let i=s instanceof Error?s.message:"Sign up failed";return{data:{user:null,session:null},error:A(i,500,"sign_up_failed")}}}async signInWithPassword(e,t){await this.initialize(),await this.db.exec("RESET ROLE");try{let s=(await this.db.query("SELECT * FROM auth.verify_user_credentials($1, $2)",[e,t])).rows[0];if(!s||!s.id)return{data:{user:null,session:null},error:A("Invalid login credentials",400,"invalid_credentials")};let i=F(s),a=await this.createSession(s);return this.emitAuthStateChange("SIGNED_IN",a),{data:{user:i,session:a},error:null}}catch(r){let s=r instanceof Error?r.message:"Sign in failed";return{data:{user:null,session:null},error:A(s,500,"sign_in_failed")}}}async createSession(e){let r=(await this.db.query("SELECT * FROM auth.create_session($1)",[e.id])).rows[0];if(!r)throw new Error("Failed to create session");let i=(await this.db.query("SELECT * FROM auth.create_refresh_token($1, $2)",[e.id,r.id])).rows[0];if(!i)throw new Error("Failed to create refresh token");let a=F(e);return{access_token:await x(this.db,a,r.id,P),token_type:"bearer",expires_in:P,expires_at:Math.floor(Date.now()/1e3)+P,refresh_token:i.token,user:a}}async refreshSession(e){await this.initialize();try{let r=(await this.db.query("SELECT * FROM auth.refresh_token($1)",[e])).rows[0];if(!r||!r.new_token)return{data:{user:null,session:null},error:A("Invalid refresh token",401,"invalid_refresh_token")};let{new_token:s,user_id:i,session_id:a}=r,c=(await this.db.query("SELECT * FROM auth.users WHERE id = $1",[i])).rows[0];if(!c)return{data:{user:null,session:null},error:A("User not found",404,"user_not_found")};let _=F(c),d={access_token:await x(this.db,_,a,P),token_type:"bearer",expires_in:P,expires_at:Math.floor(Date.now()/1e3)+P,refresh_token:s,user:_};return this.emitAuthStateChange("TOKEN_REFRESHED",d),{data:{user:_,session:d},error:null}}catch(t){let r=t instanceof Error?t.message:"Token refresh failed";return{data:{user:null,session:null},error:A(r,500,"refresh_failed")}}}async signOut(e){await this.initialize();try{if(e){let t=se(e);t&&await this.db.query("SELECT auth.sign_out($1::uuid)",[t])}return await this.db.exec("RESET ROLE"),this.emitAuthStateChange("SIGNED_OUT",null),{error:null}}catch(t){let r=t instanceof Error?t.message:"Sign out failed";return{error:A(r,500,"sign_out_failed")}}}async getUser(e){await this.initialize();try{let t=await C(this.db,e);if(!t.valid||!t.payload)return{data:{user:null},error:A(t.error||"Invalid token",401,"invalid_token")};let s=(await this.db.query("SELECT * FROM auth.users WHERE id = $1",[t.payload.sub])).rows[0];return s?{data:{user:F(s)},error:null}:{data:{user:null},error:A("User not found",404,"user_not_found")}}catch(t){let r=t instanceof Error?t.message:"Get user failed";return{data:{user:null},error:A(r,500,"get_user_failed")}}}async updateUser(e,t){await this.initialize();try{let r=await C(this.db,e);if(!r.valid||!r.payload)return{data:{user:null,session:null},error:A(r.error||"Invalid token",401,"invalid_token")};let s=r.payload.sub,i=[],a=[],o=1;if(t.email&&(i.push(`email = $${o}`),a.push(t.email),o++),t.password&&(i.push(`encrypted_password = auth.hash_password($${o})`),a.push(t.password),o++),t.data&&(i.push(`raw_user_meta_data = raw_user_meta_data || $${o}::jsonb`),a.push(JSON.stringify(t.data)),o++),i.length===0){let T=(await this.db.query("SELECT * FROM auth.users WHERE id = $1",[s])).rows[0];return T?{data:{user:F(T),session:this.currentSession},error:null}:{data:{user:null,session:null},error:A("User not found",404,"user_not_found")}}i.push("updated_at = NOW()"),a.push(s);let _=(await this.db.query(`UPDATE auth.users SET ${i.join(", ")} WHERE id = $${o} RETURNING *`,a)).rows[0];if(!_)return{data:{user:null,session:null},error:A("User not found",404,"user_not_found")};let p=F(_),d=this.currentSession;if(d){let g=await x(this.db,p,r.payload.session_id,P);d={...d,access_token:g,user:p}}return this.emitAuthStateChange("USER_UPDATED",d),{data:{user:p,session:d},error:null}}catch(r){let s=r instanceof Error?r.message:"Update user failed";return{data:{user:null,session:null},error:A(s,500,"update_user_failed")}}}getSession(){return this.currentSession}setSession(e){this.currentSession=e,e&&this.emitAuthStateChange("SIGNED_IN",e)}async verifyToken(e){return C(this.db,e)}};function b(n,e=200){return new Response(JSON.stringify(n),{status:e,headers:{"Content-Type":"application/json"}})}function ie(n){let e=n.get("Authorization");return!e||!e.startsWith("Bearer ")?null:e.slice(7)}async function ae(n){try{let e=await n.text();return e?JSON.parse(e):{}}catch{return{}}}async function oe(n,e,t){let r=n.method.toUpperCase(),i=new URL(n.url).searchParams;if(r==="POST"&&e==="/auth/v1/signup"){let a=await ae(n),o=a.email,c=a.password,_=a.options;if(!o||!c)return b({error:"email and password are required",error_description:"Missing credentials"},400);let p=await t.signUp(o,c,_);return p.error?b({error:p.error.code,error_description:p.error.message},p.error.status):p.data.session?b({access_token:p.data.session.access_token,token_type:"bearer",expires_in:p.data.session.expires_in,expires_at:p.data.session.expires_at,refresh_token:p.data.session.refresh_token,user:p.data.user}):b({error:"session_creation_failed",error_description:"Failed to create session"},500)}if(r==="POST"&&e==="/auth/v1/token"){let a=i.get("grant_type");if(a==="password"){let o=await ae(n),c=o.email,_=o.password;if(!c||!_)return b({error:"invalid_grant",error_description:"Missing credentials"},400);let p=await t.signInWithPassword(c,_);return p.error?b({error:"invalid_grant",error_description:p.error.message},p.error.status):b({access_token:p.data.session?.access_token,token_type:"bearer",expires_in:p.data.session?.expires_in,expires_at:p.data.session?.expires_at,refresh_token:p.data.session?.refresh_token,user:p.data.user})}if(a==="refresh_token"){let c=(await ae(n)).refresh_token;if(!c)return b({error:"invalid_grant",error_description:"Missing refresh token"},400);let _=await t.refreshSession(c);return _.error?b({error:"invalid_grant",error_description:_.error.message},_.error.status):b({access_token:_.data.session?.access_token,token_type:"bearer",expires_in:_.data.session?.expires_in,expires_at:_.data.session?.expires_at,refresh_token:_.data.session?.refresh_token,user:_.data.user})}return b({error:"unsupported_grant_type",error_description:"Grant type not supported"},400)}if(r==="POST"&&e==="/auth/v1/logout"){let a=ie(n.headers),o=await t.signOut(a||void 0);return o.error?b({error:o.error.code,error_description:o.error.message},o.error.status):b({})}if(r==="GET"&&e==="/auth/v1/user"){let a=ie(n.headers);if(!a)return b({error:"unauthorized",error_description:"Missing authorization header"},401);let o=await t.getUser(a);return o.error?b({error:o.error.code,error_description:o.error.message},o.error.status):b(o.data.user)}if(r==="PUT"&&e==="/auth/v1/user"){let a=ie(n.headers);if(!a)return b({error:"unauthorized",error_description:"Missing authorization header"},401);let o=await ae(n),c=await t.updateUser(a,{email:o.email,password:o.password,data:o.data});return c.error?b({error:c.error.code,error_description:c.error.message},c.error.status):b(c.data.user)}if(r==="GET"&&e==="/auth/v1/session"){let a=ie(n.headers);if(!a)return b({session:null});if((await t.getUser(a)).error)return b({session:null});let c=t.getSession();return b({session:c})}return b({error:"not_found",error_description:"Auth endpoint not found"},404)}async function we(n,e){if(!e)return await n.exec(M),{role:"anon"};let t=await C(n,e);if(!t.valid||!t.payload)return await n.exec(M),{role:"anon"};let{sub:r,role:s,email:i}=t.payload,a=re(r,s,i||"");return await n.exec(a),{userId:r,role:s,email:i}}async function Ze(n){await n.exec(M)}function Ge(n){if(!(n instanceof Error))return{message:"Unknown error occurred",code:"PGRST000"};let e=n;return{message:n.message,code:e.code||"PGRST000",details:e.detail,hint:e.hint}}function me(n,e=400){let t=Ge(n);return new Response(JSON.stringify(t),{status:e,headers:{"Content-Type":"application/json"}})}function D(n,e=200,t={}){return new Response(JSON.stringify(n),{status:e,headers:{"Content-Type":"application/json",...t}})}function Ke(n){let e=n.get("Authorization");return!e||!e.startsWith("Bearer ")?null:e.slice(7)}async function et(n){try{let e=await n.text();return e?JSON.parse(e):null}catch{return null}}async function ue(n,e,t,r){let s=n.method.toUpperCase(),i=new URL(n.url),a=new URLSearchParams(i.search);a.delete("columns");let o=a.toString(),c=e.split("/").filter(Boolean);if(c.length<3)return D({message:"Invalid path",code:"PGRST000"},400);let _=c.slice(2).join("/"),p=Ke(n.headers);try{await we(t,p);let d,g=null;switch(["POST","PATCH","PUT"].includes(s)&&(g=await et(n)),s){case"GET":d=r.parseRequest("GET",_,o);break;case"POST":d=r.parseRequest("POST",_,o,g||void 0);break;case"PATCH":d=r.parseRequest("PATCH",_,o,g||void 0);break;case"PUT":d=r.parseRequest("POST",_,o,g||void 0);break;case"DELETE":d=r.parseRequest("DELETE",_,o);break;default:return D({message:"Method not allowed",code:"PGRST105"},405)}d={sql:d.sql.replace(/RETURNING "\*"/g,"RETURNING *"),params:d.params};let T=await t.query(d.sql,[...d.params]),w=n.headers.get("Prefer")||"",S=w.includes("return=representation"),z=w.includes("return=minimal"),_e=w.includes("count=exact")||w.includes("count=planned")||w.includes("count=estimated"),U={};return _e&&(U["Content-Range"]=`0-${T.rows.length-1}/${T.rows.length}`),s==="GET"?D(T.rows,200,U):s==="POST"?z?new Response(null,{status:201,headers:U}):D(T.rows,201,U):s==="PATCH"||s==="PUT"?z?new Response(null,{status:204,headers:U}):S?D(T.rows,200,U):new Response(null,{status:204,headers:U}):s==="DELETE"?S?D(T.rows,200,U):new Response(null,{status:204,headers:U}):D(T.rows,200,U)}catch(d){return me(d)}}function tt(n,e){let t=new URL(n.url),r=new URL(e).host;if(t.host!==r)return{intercept:!1,type:"passthrough"};let s=t.pathname;return s.startsWith("/auth/v1/")?{intercept:!0,type:"auth",pathname:s}:s.startsWith("/rest/v1/")?{intercept:!0,type:"data",pathname:s}:{intercept:!1,type:"passthrough"}}function ce(n){let{db:e,parser:t,authHandler:r,supabaseUrl:s,originalFetch:i=globalThis.fetch.bind(globalThis),debug:a=!1}=n,o=a?(...c)=>console.log("[nano-supabase]",...c):()=>{};return async function(_,p){let d=_ instanceof Request?_:new Request(_,p),g=tt(d,s);if(!g.intercept)return o("Passthrough:",d.method,d.url),i(_,p);let T=d.headers.get("Authorization");console.log("\u{1F310} [FETCH_ADAPTER] Intercepting:",{type:g.type,method:d.method,pathname:g.pathname,hasAuth:!!T,authPreview:T?`${T.slice(0,30)}...`:"none"}),o("Intercepting:",g.type,d.method,g.pathname),o("Authorization header:",T?`${T.slice(0,20)}...`:"none");try{let w;if(g.type==="auth"&&g.pathname)w=await oe(d,g.pathname,r);else if(g.type==="data"&&g.pathname)w=await ue(d,g.pathname,e,t);else return i(_,p);return o("Response status:",w.status),w}catch(w){o("Error handling request:",w);let S=w instanceof Error?w.message:"Internal error";return new Response(JSON.stringify({error:"internal_error",error_description:S}),{status:500,headers:{"Content-Type":"application/json"}})}}}async function rt(n,e){let{db:t,supabaseUrl:r="http://localhost:54321",supabaseAnonKey:s="local-anon-key",debug:i=!1,originalFetch:a}=n;await N.init(),await N.initSchema(async d=>({rows:(await t.query(d)).rows}));let o=new N,c=new v(t);await c.initialize();let _=ce({db:t,parser:o,authHandler:c,supabaseUrl:r,originalFetch:a,debug:i});return{client:e(r,s,{global:{fetch:_}}),authHandler:c,parser:o,localFetch:_}}async function nt(n){let e=new v(n);return await e.initialize(),e}async function st(n){let{db:e,supabaseUrl:t="http://localhost:54321",debug:r=!1,originalFetch:s}=n;await N.init(),await N.initSchema(async c=>({rows:(await e.query(c)).rows}));let i=new N,a=new v(e);return await a.initialize(),{localFetch:ce({db:e,parser:i,authHandler:a,supabaseUrl:t,originalFetch:s,debug:r}),authHandler:a,parser:i}}var le=class{db;parser;constructor(e,t){this.db=e,this.parser=t}from(e){return new Re(this.db,this.parser,e)}async rpc(e,t){try{let r=this.parser.parseRpc(e,t);return{data:(await this.db.query(r.sql,[...r.params])).rows,error:null}}catch(r){return{data:null,error:r}}}},Re=class{db;parser;table;selectColumns;filters=[];orderBy;limitCount;offsetCount;insertData;updateData;isDelete=!1;expectSingle=!1;expectMaybeSingle=!1;constructor(e,t,r){this.db=e,this.parser=t,this.table=r}select(e="*"){return this.selectColumns=e,this}insert(e){return this.insertData=e,this}update(e){return this.updateData=e,this}delete(){return this.isDelete=!0,this}eq(e,t){return this.filters.push(`${e}=eq.${String(t)}`),this}neq(e,t){return this.filters.push(`${e}=neq.${String(t)}`),this}gt(e,t){return this.filters.push(`${e}=gt.${String(t)}`),this}gte(e,t){return this.filters.push(`${e}=gte.${String(t)}`),this}lt(e,t){return this.filters.push(`${e}=lt.${String(t)}`),this}lte(e,t){return this.filters.push(`${e}=lte.${String(t)}`),this}like(e,t){return this.filters.push(`${e}=like.${t}`),this}ilike(e,t){return this.filters.push(`${e}=ilike.${t}`),this}in(e,t){let r=t.map(String).join(",");return this.filters.push(`${e}=in.(${r})`),this}is(e,t){let r=t===null?"null":t?"true":"false";return this.filters.push(`${e}=is.${r}`),this}order(e,t){let r=t?.ascending===!1?"desc":"asc",s=t?.nullsFirst?"nullsfirst":"nullslast";return this.orderBy=`${e}.${r}.${s}`,this}limit(e){return this.limitCount=e,this}range(e,t){return this.offsetCount=e,this.limitCount=t-e+1,this}single(){return this.expectSingle=!0,this.limitCount=1,this}maybeSingle(){return this.expectMaybeSingle=!0,this.limitCount=1,this}async then(e){let t=await this.execute();return e?e(t):t}async execute(){try{let e=this.buildQueryString(),t;if(this.insertData!==void 0){let i=Array.isArray(this.insertData)?this.insertData[0]??{}:this.insertData;t=this.parser.parseInsert(this.table,i,e)}else this.updateData!==void 0?t=this.parser.parseUpdate(this.table,this.updateData,e):this.isDelete?t=this.parser.parseDelete(this.table,e):t=this.parser.parseSelect(this.table,e);let r=await this.db.query(t.sql,[...t.params]);if(this.expectSingle&&r.rows.length===0)throw new Error("No rows returned");if(this.expectSingle&&r.rows.length>1)throw new Error("Multiple rows returned");return{data:this.expectSingle||this.expectMaybeSingle?r.rows[0]??null:r.rows,error:null}}catch(e){return{data:null,error:e}}}buildQueryString(){let e=[];return this.selectColumns&&e.push(`select=${this.selectColumns}`),e.push(...this.filters),this.orderBy&&e.push(`order=${this.orderBy}`),this.limitCount!==void 0&&e.push(`limit=${this.limitCount}`),this.offsetCount!==void 0&&e.push(`offset=${this.offsetCount}`),e.join("&")}};async function it(n){await N.init(),await N.initSchema(async t=>({rows:(await n.query(t)).rows}));let e=new N;return new le(n,e)}var J=class{queues;maxSize;constructor(e=1e3){this.maxSize=e,this.queues=new Map([[0,[]],[1,[]],[2,[]],[3,[]]])}enqueue(e){let t=this.queues.get(e.priority);if(!t)throw new Error(`Invalid priority: ${e.priority}`);if(this.size()>=this.maxSize)throw new Error("Queue is full");t.push(e)}dequeue(){for(let e of[0,1,2,3]){let t=this.queues.get(e);if(t&&t.length>0)return t.shift()??null}return null}size(){return Array.from(this.queues.values()).reduce((e,t)=>e+t.length,0)}isEmpty(){return this.size()===0}clear(){for(let e of this.queues.values())e.length=0}};var Ae=class{db;queue;running=!1;config;sleepTimeoutId=null;constructor(e,t={}){this.db=e,this.queue=new J(t.maxQueueSize??1e3),this.config={maxQueueSize:t.maxQueueSize??1e3,defaultTimeout:t.defaultTimeout??5e3}}async start(){if(this.running)throw new Error("Pooler already started");this.running=!0,setTimeout(()=>{this.processQueue().catch(e=>{console.error("Queue processor error:",e),this.running=!1})},0),await new Promise(e=>setTimeout(e,0))}async stop(){this.running=!1,this.sleepTimeoutId!==null&&(clearTimeout(this.sleepTimeoutId),this.sleepTimeoutId=null),await new Promise(e=>setTimeout(e,20))}async query(e,t,r=2){return new Promise((s,i)=>{let a={id:crypto.randomUUID(),sql:e,params:t??[],priority:r,enqueuedAt:Date.now(),resolve:s,reject:i,timeoutMs:this.config.defaultTimeout};try{this.queue.enqueue(a)}catch(o){i(o instanceof Error?o:new Error(String(o)))}})}async processQueue(){for(;this.running;){let e=this.queue.dequeue();if(!e){await new Promise(t=>{let r=setTimeout(()=>{t(null)},10);this.sleepTimeoutId=r}),this.sleepTimeoutId=null;continue}try{let t=await this.executeWithTimeout(e);e.resolve(t)}catch(t){e.reject(t instanceof Error?t:new Error(String(t)))}}}async executeWithTimeout(e){let t=e.timeoutMs??this.config.defaultTimeout,r=null,s=new Promise((a,o)=>{r=setTimeout(()=>{o(new Error("Query timeout"))},t)}),i=this.db.query(e.sql,e.params).finally(()=>{r&&clearTimeout(r)});return Promise.race([i,s])}};var Be=(s=>(s[s.CRITICAL=0]="CRITICAL",s[s.HIGH=1]="HIGH",s[s.MEDIUM=2]="MEDIUM",s[s.LOW=3]="LOW",s))(Be||{});export{te as AUTH_SCHEMA_SQL,v as AuthHandler,M as CLEAR_AUTH_CONTEXT_SQL,Ae as PGlitePooler,N as PostgrestParser,J as PriorityQueue,Be as QueryPriority,le as SupabaseClient,Ze as clearAuthContext,x as createAccessToken,st as createFetchAdapter,ce as createLocalFetch,rt as createLocalSupabaseClient,it as createSupabaseClient,ne as decodeJWT,me as errorResponse,Ge as extractPostgresError,se as extractSessionIdFromToken,$e as extractUserIdFromToken,De as generateTokenPair,re as getSetAuthContextSQL,oe as handleAuthRoute,ue as handleDataRoute,nt as initializeAuth,we as setAuthContext,ye as signJWT,C as verifyAccessToken,be as verifyJWT};
//# sourceMappingURL=index.js.map
