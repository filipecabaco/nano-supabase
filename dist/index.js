var v=class n{static __wrap(e){e=e>>>0;let t=Object.create(n.prototype);return t.__wbg_ptr=e,Ce.register(t,t.__wbg_ptr,t),t}__destroy_into_raw(){let e=this.__wbg_ptr;return this.__wbg_ptr=0,Ce.unregister(this),e}free(){let e=this.__destroy_into_raw();c.__wbg_wasmqueryresult_free(e,0)}get params(){let e=c.wasmqueryresult_params(this.__wbg_ptr);return A(e)}get query(){let e,t;try{let a=c.__wbindgen_add_to_stack_pointer(-16);c.wasmqueryresult_query(a,this.__wbg_ptr);var r=T().getInt32(a+0,!0),s=T().getInt32(a+4,!0);return e=r,t=s,X(r,s)}finally{c.__wbindgen_add_to_stack_pointer(16),c.__wbindgen_export4(e,t,1)}}get tables(){let e=c.wasmqueryresult_tables(this.__wbg_ptr);return A(e)}toJSON(){let e=c.wasmqueryresult_toJSON(this.__wbg_ptr);return A(e)}};Symbol.dispose&&(v.prototype[Symbol.dispose]=v.prototype.free);function xe(n){try{let s=c.__wbindgen_add_to_stack_pointer(-16);c.buildFilterClause(s,E(n));var e=T().getInt32(s+0,!0),t=T().getInt32(s+4,!0),r=T().getInt32(s+8,!0);if(r)throw A(t);return A(e)}finally{c.__wbindgen_add_to_stack_pointer(16)}}function Pe(n){let e=c.initSchemaFromDb(E(n));return A(e)}function Fe(n,e,t){try{let u=c.__wbindgen_add_to_stack_pointer(-16),l=b(n,c.__wbindgen_export,c.__wbindgen_export2),d=h,f=b(e,c.__wbindgen_export,c.__wbindgen_export2),p=h;var r=S(t)?0:b(t,c.__wbindgen_export,c.__wbindgen_export2),s=h;c.parseDelete(u,l,d,f,p,r,s);var a=T().getInt32(u+0,!0),o=T().getInt32(u+4,!0),i=T().getInt32(u+8,!0);if(i)throw A(o);return v.__wrap(a)}finally{c.__wbindgen_add_to_stack_pointer(16)}}function $e(n,e,t,r){try{let f=c.__wbindgen_add_to_stack_pointer(-16),p=b(n,c.__wbindgen_export,c.__wbindgen_export2),g=h,R=b(e,c.__wbindgen_export,c.__wbindgen_export2),y=h;var s=S(t)?0:b(t,c.__wbindgen_export,c.__wbindgen_export2),a=h,o=S(r)?0:b(r,c.__wbindgen_export,c.__wbindgen_export2),i=h;c.parseInsert(f,p,g,R,y,s,a,o,i);var u=T().getInt32(f+0,!0),l=T().getInt32(f+4,!0),d=T().getInt32(f+8,!0);if(d)throw A(l);return v.__wrap(u)}finally{c.__wbindgen_add_to_stack_pointer(16)}}function De(n){try{let s=c.__wbindgen_add_to_stack_pointer(-16),a=b(n,c.__wbindgen_export,c.__wbindgen_export2),o=h;c.parseOnly(s,a,o);var e=T().getInt32(s+0,!0),t=T().getInt32(s+4,!0),r=T().getInt32(s+8,!0);if(r)throw A(t);return A(e)}finally{c.__wbindgen_add_to_stack_pointer(16)}}function oe(n,e,t,r,s){try{let p=c.__wbindgen_add_to_stack_pointer(-16),g=b(n,c.__wbindgen_export,c.__wbindgen_export2),R=h,y=b(e,c.__wbindgen_export,c.__wbindgen_export2),O=h,U=b(t,c.__wbindgen_export,c.__wbindgen_export2),x=h;var a=S(r)?0:b(r,c.__wbindgen_export,c.__wbindgen_export2),o=h,i=S(s)?0:b(s,c.__wbindgen_export,c.__wbindgen_export2),u=h;c.parseRequest(p,g,R,y,O,U,x,a,o,i,u);var l=T().getInt32(p+0,!0),d=T().getInt32(p+4,!0),f=T().getInt32(p+8,!0);if(f)throw A(d);return v.__wrap(l)}finally{c.__wbindgen_add_to_stack_pointer(16)}}function Be(n,e,t,r){try{let g=c.__wbindgen_add_to_stack_pointer(-16),R=b(n,c.__wbindgen_export,c.__wbindgen_export2),y=h;var s=S(e)?0:b(e,c.__wbindgen_export,c.__wbindgen_export2),a=h,o=S(t)?0:b(t,c.__wbindgen_export,c.__wbindgen_export2),i=h,u=S(r)?0:b(r,c.__wbindgen_export,c.__wbindgen_export2),l=h;c.parseRpc(g,R,y,s,a,o,i,u,l);var d=T().getInt32(g+0,!0),f=T().getInt32(g+4,!0),p=T().getInt32(g+8,!0);if(p)throw A(f);return v.__wrap(d)}finally{c.__wbindgen_add_to_stack_pointer(16)}}function Ge(n,e,t,r){try{let l=c.__wbindgen_add_to_stack_pointer(-16),d=b(n,c.__wbindgen_export,c.__wbindgen_export2),f=h,p=b(e,c.__wbindgen_export,c.__wbindgen_export2),g=h,R=b(t,c.__wbindgen_export,c.__wbindgen_export2),y=h;var s=S(r)?0:b(r,c.__wbindgen_export,c.__wbindgen_export2),a=h;c.parseUpdate(l,d,f,p,g,R,y,s,a);var o=T().getInt32(l+0,!0),i=T().getInt32(l+4,!0),u=T().getInt32(l+8,!0);if(u)throw A(i);return v.__wrap(o)}finally{c.__wbindgen_add_to_stack_pointer(16)}}function et(){return{__proto__:null,"./postgrest_parser_bg.js":{__proto__:null,__wbg_Error_8c4e43fe74559d73:function(e,t){let r=Error(X(e,t));return E(r)},__wbg_Number_04624de7d0e8332d:function(e){return Number(_(e))},__wbg_String_8f0eb39a4a4c2f66:function(e,t){let r=String(_(t)),s=b(r,c.__wbindgen_export,c.__wbindgen_export2),a=h;T().setInt32(e+4,a,!0),T().setInt32(e+0,s,!0)},__wbg___wbindgen_bigint_get_as_i64_8fcf4ce7f1ca72a2:function(e,t){let r=_(t),s=typeof r=="bigint"?r:void 0;T().setBigInt64(e+8,S(s)?BigInt(0):s,!0),T().setInt32(e+0,!S(s),!0)},__wbg___wbindgen_boolean_get_bbbb1c18aa2f5e25:function(e){let t=_(e),r=typeof t=="boolean"?t:void 0;return S(r)?16777215:r?1:0},__wbg___wbindgen_debug_string_0bc8482c6e3508ae:function(e,t){let r=Re(_(t)),s=b(r,c.__wbindgen_export,c.__wbindgen_export2),a=h;T().setInt32(e+4,a,!0),T().setInt32(e+0,s,!0)},__wbg___wbindgen_in_47fa6863be6f2f25:function(e,t){return _(e)in _(t)},__wbg___wbindgen_is_bigint_31b12575b56f32fc:function(e){return typeof _(e)=="bigint"},__wbg___wbindgen_is_function_0095a73b8b156f76:function(e){return typeof _(e)=="function"},__wbg___wbindgen_is_object_5ae8e5880f2c1fbd:function(e){let t=_(e);return typeof t=="object"&&t!==null},__wbg___wbindgen_is_string_cd444516edc5b180:function(e){return typeof _(e)=="string"},__wbg___wbindgen_is_undefined_9e4d92534c42d778:function(e){return _(e)===void 0},__wbg___wbindgen_jsval_eq_11888390b0186270:function(e,t){return _(e)===_(t)},__wbg___wbindgen_jsval_loose_eq_9dd77d8cd6671811:function(e,t){return _(e)==_(t)},__wbg___wbindgen_number_get_8ff4255516ccad3e:function(e,t){let r=_(t),s=typeof r=="number"?r:void 0;T().setFloat64(e+8,S(s)?0:s,!0),T().setInt32(e+0,!S(s),!0)},__wbg___wbindgen_string_get_72fb696202c56729:function(e,t){let r=_(t),s=typeof r=="string"?r:void 0;var a=S(s)?0:b(s,c.__wbindgen_export,c.__wbindgen_export2),o=h;T().setInt32(e+4,o,!0),T().setInt32(e+0,a,!0)},__wbg___wbindgen_throw_be289d5034ed271b:function(e,t){throw new Error(X(e,t))},__wbg__wbg_cb_unref_d9b87ff7982e3b21:function(e){_(e)._wbg_cb_unref()},__wbg_call_389efe28435a9388:function(){return ae(function(e,t){let r=_(e).call(_(t));return E(r)},arguments)},__wbg_call_4708e0c13bdc8e95:function(){return ae(function(e,t,r){let s=_(e).call(_(t),_(r));return E(s)},arguments)},__wbg_done_57b39ecd9addfe81:function(e){return _(e).done},__wbg_entries_58c7934c745daac7:function(e){let t=Object.entries(_(e));return E(t)},__wbg_error_7534b8e9a36f1ab4:function(e,t){let r,s;try{r=e,s=t,console.error(X(e,t))}finally{c.__wbindgen_export4(r,s,1)}},__wbg_get_9b94d73e6221f75c:function(e,t){let r=_(e)[t>>>0];return E(r)},__wbg_get_b3ed3ad4be2bc8ac:function(){return ae(function(e,t){let r=Reflect.get(_(e),_(t));return E(r)},arguments)},__wbg_get_with_ref_key_1dc361bd10053bfe:function(e,t){let r=_(e)[_(t)];return E(r)},__wbg_instanceof_ArrayBuffer_c367199e2fa2aa04:function(e){let t;try{t=_(e)instanceof ArrayBuffer}catch{t=!1}return t},__wbg_instanceof_Map_53af74335dec57f4:function(e){let t;try{t=_(e)instanceof Map}catch{t=!1}return t},__wbg_instanceof_Uint8Array_9b9075935c74707c:function(e){let t;try{t=_(e)instanceof Uint8Array}catch{t=!1}return t},__wbg_isArray_d314bb98fcf08331:function(e){return Array.isArray(_(e))},__wbg_isSafeInteger_bfbc7332a9768d2a:function(e){return Number.isSafeInteger(_(e))},__wbg_iterator_6ff6560ca1568e55:function(){return E(Symbol.iterator)},__wbg_length_32ed9a279acd054c:function(e){return _(e).length},__wbg_length_35a7bace40f36eac:function(e){return _(e).length},__wbg_log_6b5ca2e6124b2808:function(e){console.log(_(e))},__wbg_new_361308b2356cecd0:function(){let e=new Object;return E(e)},__wbg_new_3eb36ae241fe6f44:function(){let e=new Array;return E(e)},__wbg_new_8a6f238a6ece86ea:function(){let e=new Error;return E(e)},__wbg_new_b5d9e2fb389fef91:function(e,t){try{var r={a:e,b:t},s=(o,i)=>{let u=r.a;r.a=0;try{return rt(u,r.b,o,i)}finally{r.a=u}};let a=new Promise(s);return E(a)}finally{r.a=r.b=0}},__wbg_new_dca287b076112a51:function(){return E(new Map)},__wbg_new_dd2b680c8bf6ae29:function(e){let t=new Uint8Array(_(e));return E(t)},__wbg_new_no_args_1c7c842f08d00ebb:function(e,t){let r=new Function(X(e,t));return E(r)},__wbg_next_3482f54c49e8af19:function(){return ae(function(e){let t=_(e).next();return E(t)},arguments)},__wbg_next_418f80d8f5303233:function(e){let t=_(e).next;return E(t)},__wbg_prototypesetcall_bdcdcc5842e4d77d:function(e,t,r){Uint8Array.prototype.set.call(st(e,t),_(r))},__wbg_queueMicrotask_0aa0a927f78f5d98:function(e){let t=_(e).queueMicrotask;return E(t)},__wbg_queueMicrotask_5bb536982f78a56f:function(e){queueMicrotask(_(e))},__wbg_resolve_002c4b7d9d8f6b64:function(e){let t=Promise.resolve(_(e));return E(t)},__wbg_set_1eb0999cf5d27fc8:function(e,t,r){let s=_(e).set(_(t),_(r));return E(s)},__wbg_set_3f1d0b984ed272ed:function(e,t,r){_(e)[A(t)]=A(r)},__wbg_set_f43e577aea94465b:function(e,t,r){_(e)[t>>>0]=A(r)},__wbg_stack_0ed75d68575b0f3c:function(e,t){let r=_(t).stack,s=b(r,c.__wbindgen_export,c.__wbindgen_export2),a=h;T().setInt32(e+4,a,!0),T().setInt32(e+0,s,!0)},__wbg_static_accessor_GLOBAL_12837167ad935116:function(){let e=typeof global>"u"?null:global;return S(e)?0:E(e)},__wbg_static_accessor_GLOBAL_THIS_e628e89ab3b1c95f:function(){let e=typeof globalThis>"u"?null:globalThis;return S(e)?0:E(e)},__wbg_static_accessor_SELF_a621d3dfbb60d0ce:function(){let e=typeof self>"u"?null:self;return S(e)?0:E(e)},__wbg_static_accessor_WINDOW_f8727f0cf888e0bd:function(){let e=typeof window>"u"?null:window;return S(e)?0:E(e)},__wbg_then_0d9fe2c7b1857d32:function(e,t,r){let s=_(e).then(_(t),_(r));return E(s)},__wbg_then_b9e7b3b5f1a9e1b5:function(e,t){let r=_(e).then(_(t));return E(r)},__wbg_value_0546255b415e96c1:function(e){let t=_(e).value;return E(t)},__wbindgen_cast_0000000000000001:function(e,t){let r=at(e,t,c.__wasm_bindgen_func_elem_363,tt);return E(r)},__wbindgen_cast_0000000000000002:function(e){return E(e)},__wbindgen_cast_0000000000000003:function(e){return E(e)},__wbindgen_cast_0000000000000004:function(e,t){let r=X(e,t);return E(r)},__wbindgen_cast_0000000000000005:function(e){let t=BigInt.asUintN(64,e);return E(t)},__wbindgen_object_clone_ref:function(e){let t=_(e);return E(t)},__wbindgen_object_drop_ref:function(e){A(e)}}}}function tt(n,e,t){c.__wasm_bindgen_func_elem_364(n,e,E(t))}function rt(n,e,t,r){c.__wasm_bindgen_func_elem_443(n,e,E(t),E(r))}var Ce=typeof FinalizationRegistry>"u"?{register:()=>{},unregister:()=>{}}:new FinalizationRegistry(n=>c.__wbg_wasmqueryresult_free(n>>>0,1));function E(n){ee===C.length&&C.push(C.length+1);let e=ee;return ee=C[e],C[e]=n,e}var ve=typeof FinalizationRegistry>"u"?{register:()=>{},unregister:()=>{}}:new FinalizationRegistry(n=>n.dtor(n.a,n.b));function Re(n){let e=typeof n;if(e=="number"||e=="boolean"||n==null)return`${n}`;if(e=="string")return`"${n}"`;if(e=="symbol"){let s=n.description;return s==null?"Symbol":`Symbol(${s})`}if(e=="function"){let s=n.name;return typeof s=="string"&&s.length>0?`Function(${s})`:"Function"}if(Array.isArray(n)){let s=n.length,a="[";s>0&&(a+=Re(n[0]));for(let o=1;o<s;o++)a+=", "+Re(n[o]);return a+="]",a}let t=/\[object ([^\]]+)\]/.exec(toString.call(n)),r;if(t&&t.length>1)r=t[1];else return toString.call(n);if(r=="Object")try{return"Object("+JSON.stringify(n)+")"}catch{return"Object"}return n instanceof Error?`${n.name}: ${n.message}
${n.stack}`:r}function nt(n){n<132||(C[n]=ee,ee=n)}function st(n,e){return n=n>>>0,Z().subarray(n/1,n/1+e)}var D=null;function T(){return(D===null||D.buffer.detached===!0||D.buffer.detached===void 0&&D.buffer!==c.memory.buffer)&&(D=new DataView(c.memory.buffer)),D}function X(n,e){return n=n>>>0,ot(n,e)}var K=null;function Z(){return(K===null||K.byteLength===0)&&(K=new Uint8Array(c.memory.buffer)),K}function _(n){return C[n]}function ae(n,e){try{return n.apply(this,e)}catch(t){c.__wbindgen_export3(E(t))}}var C=new Array(128).fill(void 0);C.push(void 0,null,!0,!1);var ee=C.length;function S(n){return n==null}function at(n,e,t,r){let s={a:n,b:e,cnt:1,dtor:t},a=(...o)=>{s.cnt++;let i=s.a;s.a=0;try{return r(i,s.b,...o)}finally{s.a=i,a._wbg_cb_unref()}};return a._wbg_cb_unref=()=>{--s.cnt===0&&(s.dtor(s.a,s.b),s.a=0,ve.unregister(s))},ve.register(a,s,s),a}function b(n,e,t){if(t===void 0){let i=te.encode(n),u=e(i.length,1)>>>0;return Z().subarray(u,u+i.length).set(i),h=i.length,u}let r=n.length,s=e(r,1)>>>0,a=Z(),o=0;for(;o<r;o++){let i=n.charCodeAt(o);if(i>127)break;a[s+o]=i}if(o!==r){o!==0&&(n=n.slice(o)),s=t(s,r,r=o+n.length*3,1)>>>0;let i=Z().subarray(s+o,s+r),u=te.encodeInto(n,i);o+=u.written,s=t(s,r,o,1)>>>0}return h=o,s}function A(n){let e=_(n);return nt(n),e}var ie=new TextDecoder("utf-8",{ignoreBOM:!0,fatal:!0});ie.decode();var it=2146435072,we=0;function ot(n,e){return we+=e,we>=it&&(ie=new TextDecoder("utf-8",{ignoreBOM:!0,fatal:!0}),ie.decode(),we=e),ie.decode(Z().subarray(n,n+e))}var te=new TextEncoder;"encodeInto"in te||(te.encodeInto=function(n,e){let t=te.encode(n);return e.set(t),{read:n.length,written:t.length}});var h=0,ut,c;function ct(n,e){return c=n.exports,ut=e,D=null,K=null,c.__wbindgen_start(),c}async function lt(n,e){if(typeof Response=="function"&&n instanceof Response){if(typeof WebAssembly.instantiateStreaming=="function")try{return await WebAssembly.instantiateStreaming(n,e)}catch(s){if(n.ok&&t(n.type)&&n.headers.get("Content-Type")!=="application/wasm")console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n",s);else throw s}let r=await n.arrayBuffer();return await WebAssembly.instantiate(r,e)}else{let r=await WebAssembly.instantiate(n,e);return r instanceof WebAssembly.Instance?{instance:r,module:n}:r}function t(r){switch(r){case"basic":case"cors":case"default":return!0}return!1}}async function Me(n){if(c!==void 0)return c;n!==void 0&&(Object.getPrototypeOf(n)===Object.prototype?{module_or_path:n}=n:console.warn("using deprecated parameters for the initialization function; pass a single object instead")),n===void 0&&(n=new URL("postgrest_parser_bg.wasm",import.meta.url));let e=et();(typeof n=="string"||typeof Request=="function"&&n instanceof Request||typeof URL=="function"&&n instanceof URL)&&(n=fetch(n));let{instance:t,module:r}=await lt(await n,e);return ct(t,r)}function B(n){return{query:n.query,params:n.params,tables:n.tables}}function W(n){return n?JSON.stringify(n):void 0}function ue(n){if(!n)return;let e=[];return n.return&&e.push(`return=${n.return}`),n.resolution&&e.push(`resolution=${n.resolution}`),n.missing&&e.push(`missing=${n.missing}`),n.count&&e.push(`count=${n.count}`),e.length>0?e.join(","):void 0}function z(n,e){let t=[];if(n)for(let[r,s]of Object.entries(n))t.push(`${r}=${s}`);if(e?.select){let r=Array.isArray(e.select)?e.select.join(","):e.select;t.push(`select=${r}`)}if(e?.order){let r=Array.isArray(e.order)?e.order.join(","):e.order;t.push(`order=${r}`)}if(e?.limit!==void 0&&t.push(`limit=${e.limit}`),e?.offset!==void 0&&t.push(`offset=${e.offset}`),e?.onConflict){let r=Array.isArray(e.onConflict)?e.onConflict.join(","):e.onConflict;t.push(`on_conflict=${r}`)}if(e?.returning){let r=Array.isArray(e.returning)?e.returning.join(","):e.returning;t.push(`returning=${r}`)}return t.join("&")}var Se=class{parseRequest(e,t,r,s,a){let o=s?JSON.stringify(s):void 0,i=a?W(a):void 0,u=oe(e,t,r,o,i);return B(u)}select(e,t={}){let r=z(t.filters,t),s=t.count?{Prefer:`count=${t.count}`}:void 0,a=oe("GET",e,r,void 0,W(s));return B(a)}insert(e,t,r={}){let s=z(void 0,{onConflict:r.onConflict,returning:r.returning}),a=ue(r.prefer),o=a?{Prefer:a}:void 0,i=$e(e,JSON.stringify(t),s||void 0,W(o));return B(i)}upsert(e,t,r,s={}){let a={};for(let d of r)d in t&&(a[d]=`eq.${t[d]}`);let o=z(a,{returning:s.returning}),i=ue(s.prefer),u=i?{Prefer:i}:void 0,l=oe("PUT",e,o,JSON.stringify(t),W(u));return B(l)}update(e,t,r,s={}){let a=z(r,{returning:s.returning}),o=ue(s.prefer),i=o?{Prefer:o}:void 0,u=Ge(e,JSON.stringify(t),a,W(i));return B(u)}delete(e,t,r={}){let s=z(t,{returning:r.returning}),a=ue(r.prefer),i=Fe(e,s,W(a?{Prefer:a}:void 0));return B(i)}rpc(e,t={},r={}){let s=z(r.filters,r),a=Be(e,JSON.stringify(t),s||void 0,void 0);return B(a)}parseOnly(e){return De(e)}buildFilterClause(e){return xe(e)}};function je(){return new Se}var k=class n{client;static initPromise=null;constructor(){this.client=je()}static async init(){n.initPromise||(n.initPromise=Me()),await n.initPromise}static async initSchema(e){await n.init(),await Pe(e)}parseSelect(e,t=""){return this.parseRequest("GET",e,t)}parseInsert(e,t,r=""){return this.parseRequest("POST",e,r,t)}parseUpdate(e,t,r){return this.parseRequest("PATCH",e,r,t)}parseDelete(e,t){return this.parseRequest("DELETE",e,t)}parseRpc(e,t,r=""){let s=`rpc/${e}`;return this.parseRequest("POST",s,r,t)}parseRequest(e,t,r="",s){let a=this.client.parseRequest(e,t,r,s??null,null);return this.convertResult(a)}convertResult(e){return{sql:e.query,params:Array.isArray(e.params)?e.params:[],tables:Array.isArray(e.tables)?e.tables:[]}}};var le=`
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
  v_old_token_id BIGINT;
  v_old_user_id UUID;
  v_old_session_id UUID;
  v_old_token_value TEXT;
  v_new_token TEXT;
BEGIN
  -- Find and validate the old token
  SELECT rt.id, rt.user_id, rt.session_id, rt.token
  INTO v_old_token_id, v_old_user_id, v_old_session_id, v_old_token_value
  FROM auth.refresh_tokens rt
  WHERE rt.token = p_refresh_token
    AND rt.revoked = FALSE;

  IF v_old_token_id IS NULL THEN
    RETURN;
  END IF;

  -- Revoke the old token
  UPDATE auth.refresh_tokens
  SET revoked = TRUE, updated_at = NOW()
  WHERE id = v_old_token_id;

  -- Update session refreshed_at
  UPDATE auth.sessions
  SET refreshed_at = NOW(), updated_at = NOW()
  WHERE id = v_old_session_id;

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
    v_old_user_id,
    v_old_session_id,
    v_old_token_value,
    NOW(),
    NOW()
  ) RETURNING token INTO v_new_token;

  -- Return the result
  RETURN QUERY SELECT v_new_token, v_old_user_id, v_old_session_id;
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
GRANT EXECUTE ON FUNCTION auth.get_signing_key() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.create_access_token(UUID, UUID, TEXT, TEXT, JSONB, JSONB, INT) TO service_role;
GRANT EXECUTE ON FUNCTION auth.verify_access_token(TEXT) TO service_role;
`;function ce(n){return n.replace(/'/g,"''")}function de(n,e,t){let r=JSON.stringify({sub:n,role:e,email:t,aud:"authenticated"}),s=ce(n),a=ce(e),o=ce(t),i=ce(r);return`
    SET ROLE ${a};
    SELECT set_config('request.jwt.claim.sub', '${s}', false);
    SELECT set_config('request.jwt.claim.role', '${a}', false);
    SELECT set_config('request.jwt.claim.email', '${o}', false);
    SELECT set_config('request.jwt.claims', '${i}', false);
  `}var J=`
  SET ROLE anon;
  SELECT set_config('request.jwt.claim.sub', '', false);
  SELECT set_config('request.jwt.claim.role', 'anon', false);
  SELECT set_config('request.jwt.claim.email', '', false);
  SELECT set_config('request.jwt.claims', '{"role": "anon"}', false);
`;function Ae(n){return btoa(String.fromCharCode(...n)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"")}function Ne(n){let e=n.replace(/-/g,"+").replace(/_/g,"/").padEnd(n.length+(4-n.length%4)%4,"="),t=atob(e),r=new Uint8Array(t.length);for(let s=0;s<t.length;s++)r[s]=t.charCodeAt(s);return r}var V=new TextEncoder,He=new TextDecoder;async function Ue(n,e){let t={alg:"HS256",typ:"JWT"},r=Ae(V.encode(JSON.stringify(t))),s=Ae(V.encode(JSON.stringify(n))),a=`${r}.${s}`,o=await crypto.subtle.importKey("raw",V.encode(e),{name:"HMAC",hash:"SHA-256"},!1,["sign"]),i=await crypto.subtle.sign("HMAC",o,V.encode(a)),u=Ae(new Uint8Array(i));return`${a}.${u}`}async function Ie(n,e){try{let t=n.split(".");if(t.length!==3)return{valid:!1,error:"Invalid token format"};let[r,s,a]=t;if(!r||!s||!a)return{valid:!1,error:"Invalid token format"};let o=`${r}.${s}`,i=await crypto.subtle.importKey("raw",V.encode(e),{name:"HMAC",hash:"SHA-256"},!1,["verify"]),u=Ne(a);if(!await crypto.subtle.verify("HMAC",i,u,V.encode(o)))return{valid:!1,error:"Invalid signature"};let d=He.decode(Ne(s)),f=JSON.parse(d),p=Math.floor(Date.now()/1e3);return f.exp&&f.exp<p?{valid:!1,error:"Token expired"}:{valid:!0,payload:f}}catch(t){return{valid:!1,error:t instanceof Error?t.message:"Verification failed"}}}function _e(n){try{let e=n.split(".");if(e.length!==3)return null;let t=e[1];if(!t)return null;let r=He.decode(Ne(t));return JSON.parse(r)}catch{return null}}var qe=3600,re=null;async function Qe(n){if(re)return re;let e=await n.query("SELECT value FROM auth.config WHERE key = 'jwt_secret'");if(e.rows.length>0&&e.rows[0])return re=e.rows[0].value,re;let t=new Uint8Array(32);crypto.getRandomValues(t);let r=Array.from(t,s=>s.toString(16).padStart(2,"0")).join("");return await n.exec(`
    INSERT INTO auth.config (key, value)
    VALUES ('jwt_secret', '${r}')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `),re=r,r}async function G(n,e,t,r=qe){let s=await Qe(n),a=Math.floor(Date.now()/1e3),o={sub:e.id,aud:"authenticated",role:e.role,email:e.email||void 0,session_id:t,iat:a,exp:a+r,user_metadata:e.user_metadata||{},app_metadata:e.app_metadata||{}};return Ue(o,s)}async function P(n,e){let t=await Qe(n);return Ie(e,t)}async function Xe(n,e,t,r,s=qe){let a=await G(n,e,t,s),o=Math.floor(Date.now()/1e3);return{accessToken:a,refreshToken:r,expiresIn:s,expiresAt:o+s}}function We(n){return _e(n)?.sub||null}function pe(n){return _e(n)?.session_id||null}var M=3600;function j(n){return{id:n.id,aud:n.aud,role:n.role,email:n.email,email_confirmed_at:n.email_confirmed_at||void 0,phone:n.phone||void 0,phone_confirmed_at:n.phone_confirmed_at||void 0,confirmed_at:n.email_confirmed_at||n.phone_confirmed_at||void 0,last_sign_in_at:n.last_sign_in_at||void 0,app_metadata:n.raw_app_meta_data||{},user_metadata:n.raw_user_meta_data||{},created_at:n.created_at,updated_at:n.updated_at}}function N(n,e,t){return{message:n,status:e,code:t}}var F=class{db;initialized=!1;subscriptions=new Map;currentSession=null;constructor(e){this.db=e}async initialize(){this.initialized||(await this.db.exec(le),this.initialized=!0)}emitAuthStateChange(e,t){this.currentSession=t;for(let r of this.subscriptions.values())try{r(e,t)}catch(s){console.error("Auth state change callback error:",s)}}onAuthStateChange(e){let t=crypto.randomUUID();return this.subscriptions.set(t,e),queueMicrotask(()=>{e("INITIAL_SESSION",this.currentSession)}),{id:t,callback:e,unsubscribe:()=>{this.subscriptions.delete(t)}}}async signUp(e,t,r){await this.initialize(),await this.db.exec("RESET ROLE");try{if((await this.db.query("SELECT * FROM auth.users WHERE email = $1",[e])).rows.length>0)return{data:{user:null,session:null},error:N("User already registered",400,"user_already_exists")};let a=r?.data?JSON.stringify(r.data):"{}",o=await this.db.query("SELECT * FROM auth.create_user($1, $2, $3::jsonb)",[e,t,a]);if(o.rows.length===0)return{data:{user:null,session:null},error:N("Failed to create user",500,"user_creation_failed")};let i=o.rows[0];if(!i)return{data:{user:null,session:null},error:N("Failed to create user",500,"user_creation_failed")};let u=j(i),l=await this.createSession(i);return this.emitAuthStateChange("SIGNED_IN",l),{data:{user:u,session:l},error:null}}catch(s){let a=s instanceof Error?s.message:"Sign up failed";return{data:{user:null,session:null},error:N(a,500,"sign_up_failed")}}}async signInWithPassword(e,t){await this.initialize(),await this.db.exec("RESET ROLE");try{let s=(await this.db.query("SELECT * FROM auth.verify_user_credentials($1, $2)",[e,t])).rows[0];if(!s||!s.id)return{data:{user:null,session:null},error:N("Invalid login credentials",400,"invalid_credentials")};let a=j(s),o=await this.createSession(s);return this.emitAuthStateChange("SIGNED_IN",o),{data:{user:a,session:o},error:null}}catch(r){let s=r instanceof Error?r.message:"Sign in failed";return{data:{user:null,session:null},error:N(s,500,"sign_in_failed")}}}async createSession(e){let r=(await this.db.query("SELECT * FROM auth.create_session($1)",[e.id])).rows[0];if(!r)throw new Error("Failed to create session");let a=(await this.db.query("SELECT * FROM auth.create_refresh_token($1, $2)",[e.id,r.id])).rows[0];if(!a)throw new Error("Failed to create refresh token");let o=j(e);return{access_token:await G(this.db,o,r.id,M),token_type:"bearer",expires_in:M,expires_at:Math.floor(Date.now()/1e3)+M,refresh_token:a.token,user:o}}async refreshSession(e){await this.initialize();try{let r=(await this.db.query("SELECT * FROM auth.refresh_token($1)",[e])).rows[0];if(!r||!r.new_token)return{data:{user:null,session:null},error:N("Invalid refresh token",401,"invalid_refresh_token")};let{new_token:s,user_id:a,session_id:o}=r,u=(await this.db.query("SELECT * FROM auth.users WHERE id = $1",[a])).rows[0];if(!u)return{data:{user:null,session:null},error:N("User not found",404,"user_not_found")};let l=j(u),f={access_token:await G(this.db,l,o,M),token_type:"bearer",expires_in:M,expires_at:Math.floor(Date.now()/1e3)+M,refresh_token:s,user:l};return this.emitAuthStateChange("TOKEN_REFRESHED",f),{data:{user:l,session:f},error:null}}catch(t){let r=t instanceof Error?t.message:"Token refresh failed";return{data:{user:null,session:null},error:N(r,500,"refresh_failed")}}}async signOut(e){await this.initialize();try{if(e){let t=pe(e);t&&await this.db.query("SELECT auth.sign_out($1::uuid)",[t])}return await this.db.exec("RESET ROLE"),this.emitAuthStateChange("SIGNED_OUT",null),{error:null}}catch(t){let r=t instanceof Error?t.message:"Sign out failed";return{error:N(r,500,"sign_out_failed")}}}async getUser(e){await this.initialize();try{let t=await P(this.db,e);if(!t.valid||!t.payload)return{data:{user:null},error:N(t.error||"Invalid token",401,"invalid_token")};let s=(await this.db.query("SELECT * FROM auth.users WHERE id = $1",[t.payload.sub])).rows[0];return s?{data:{user:j(s)},error:null}:{data:{user:null},error:N("User not found",404,"user_not_found")}}catch(t){let r=t instanceof Error?t.message:"Get user failed";return{data:{user:null},error:N(r,500,"get_user_failed")}}}async updateUser(e,t){await this.initialize();try{let r=await P(this.db,e);if(!r.valid||!r.payload)return{data:{user:null,session:null},error:N(r.error||"Invalid token",401,"invalid_token")};let s=r.payload.sub,a=[],o=[],i=1;if(t.email&&(a.push(`email = $${i}`),o.push(t.email),i++),t.password&&(a.push(`encrypted_password = auth.hash_password($${i})`),o.push(t.password),i++),t.data&&(a.push(`raw_user_meta_data = raw_user_meta_data || $${i}::jsonb`),o.push(JSON.stringify(t.data)),i++),a.length===0){let g=(await this.db.query("SELECT * FROM auth.users WHERE id = $1",[s])).rows[0];return g?{data:{user:j(g),session:this.currentSession},error:null}:{data:{user:null,session:null},error:N("User not found",404,"user_not_found")}}a.push("updated_at = NOW()"),o.push(s);let l=(await this.db.query(`UPDATE auth.users SET ${a.join(", ")} WHERE id = $${i} RETURNING *`,o)).rows[0];if(!l)return{data:{user:null,session:null},error:N("User not found",404,"user_not_found")};let d=j(l),f=this.currentSession;if(f){let p=await G(this.db,d,r.payload.session_id,M);f={...f,access_token:p,user:d}}return this.emitAuthStateChange("USER_UPDATED",f),{data:{user:d,session:f},error:null}}catch(r){let s=r instanceof Error?r.message:"Update user failed";return{data:{user:null,session:null},error:N(s,500,"update_user_failed")}}}getSession(){return this.currentSession}setSession(e){this.currentSession=e,e&&this.emitAuthStateChange("SIGNED_IN",e)}async verifyToken(e){return P(this.db,e)}};var Y=class{store=new Map;async put(e,t,r){this.store.set(e,{data:t,metadata:r})}async get(e){return this.store.get(e)??null}async delete(e){return this.store.delete(e)}async deleteByPrefix(e){let t=0;for(let r of this.store.keys())r.startsWith(e)&&(this.store.delete(r),t++);return t}async exists(e){return this.store.has(e)}async copy(e,t){let r=this.store.get(e);return r?(this.store.set(t,{data:new Uint8Array(r.data),metadata:{...r.metadata}}),!0):!1}};var ge=`
-- Create storage schema
CREATE SCHEMA IF NOT EXISTS storage;

-- Grant permissions to roles (created by auth schema)
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Buckets table
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  owner_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE UNIQUE INDEX IF NOT EXISTS bname ON storage.buckets USING btree (name);

-- Objects table
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  version text,
  user_metadata jsonb,
  CONSTRAINT objects_bucketId_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS bucketid_objname ON storage.objects USING btree (bucket_id, name);
CREATE INDEX IF NOT EXISTS name_prefix_search ON storage.objects(name text_pattern_ops);

-- Enable RLS on objects (users add their own policies)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Enable RLS on buckets
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

-- Utility functions

CREATE OR REPLACE FUNCTION storage.foldername(name text)
  RETURNS text[]
  LANGUAGE plpgsql
AS $$
DECLARE
  _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END
$$;

CREATE OR REPLACE FUNCTION storage.filename(name text)
  RETURNS text
  LANGUAGE plpgsql
AS $$
DECLARE
  _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[array_length(_parts, 1)];
END
$$;

CREATE OR REPLACE FUNCTION storage.extension(name text)
  RETURNS text
  LANGUAGE plpgsql
AS $$
DECLARE
  _parts text[];
  _filename text;
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  SELECT _parts[array_length(_parts, 1)] INTO _filename;
  RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;

CREATE OR REPLACE FUNCTION storage.search(
  prefix text,
  bucketname text,
  limits int DEFAULT 100,
  levels int DEFAULT 1,
  offsets int DEFAULT 0
)
  RETURNS TABLE (
    name text,
    id uuid,
    updated_at timestamptz,
    created_at timestamptz,
    last_accessed_at timestamptz,
    metadata jsonb
  )
  LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    WITH files_folders AS (
      SELECT ((string_to_array(objects.name, '/'))[levels]) AS folder
      FROM storage.objects
      WHERE objects.name ILIKE prefix || '%'
        AND bucket_id = bucketname
      GROUP BY folder
      LIMIT limits
      OFFSET offsets
    )
    SELECT
      files_folders.folder AS name,
      objects.id,
      objects.updated_at,
      objects.created_at,
      objects.last_accessed_at,
      objects.metadata
    FROM files_folders
    LEFT JOIN storage.objects
      ON prefix || files_folders.folder = objects.name
      AND objects.bucket_id = bucketname;
END
$$;

-- Grant table permissions explicitly
GRANT ALL ON storage.buckets TO anon, authenticated, service_role;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;

-- Grant function permissions
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.filename(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.extension(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.search(text, text, int, int, int) TO anon, authenticated, service_role;
`;function ze(n){return n.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}function Je(n){let e=n.replace(/-/g,"+").replace(/_/g,"/");for(;e.length%4;)e+="=";return e}var H=class{db;backend;initialized=!1;constructor(e,t){this.db=e,this.backend=t??new Y}async initialize(){this.initialized||(await this.db.exec(ge),this.initialized=!0)}getBackend(){return this.backend}async listBuckets(){return await this.initialize(),(await this.db.query("SELECT * FROM storage.buckets ORDER BY name")).rows}async getBucket(e){return await this.initialize(),(await this.db.query("SELECT * FROM storage.buckets WHERE id = $1",[e])).rows[0]??null}async createBucket(e){await this.initialize();let t=e.id??e.name,s=(await this.db.query(`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,[t,e.name,e.public??!1,e.file_size_limit??null,e.allowed_mime_types??null])).rows[0];if(!s)throw new Error("Failed to create bucket");return s}async updateBucket(e,t){await this.initialize();let r=[],s=[],a=1;if(t.public!==void 0&&(r.push(`public = $${a++}`),s.push(t.public)),t.file_size_limit!==void 0&&(r.push(`file_size_limit = $${a++}`),s.push(t.file_size_limit)),t.allowed_mime_types!==void 0&&(r.push(`allowed_mime_types = $${a++}`),s.push(t.allowed_mime_types)),r.length===0){let u=await this.getBucket(e);if(!u)throw new Error("Bucket not found");return u}r.push("updated_at = now()"),s.push(e);let i=(await this.db.query(`UPDATE storage.buckets SET ${r.join(", ")} WHERE id = $${a} RETURNING *`,s)).rows[0];if(!i)throw new Error("Bucket not found");return i}async emptyBucket(e){await this.initialize(),await this.db.query("DELETE FROM storage.objects WHERE bucket_id = $1",[e]),await this.backend.deleteByPrefix(`${e}/`)}async deleteBucket(e){await this.initialize();let t=await this.db.query("SELECT count(*)::text as count FROM storage.objects WHERE bucket_id = $1",[e]);if(t.rows[0]&&parseInt(t.rows[0].count,10)>0)throw new Error("Bucket not empty");await this.db.query("DELETE FROM storage.buckets WHERE id = $1",[e])}async uploadObject(e,t,r,s,a){await this.initialize();let o=await this.getBucket(e);if(!o)throw new Error("Bucket not found");if(o.file_size_limit&&r.byteLength>o.file_size_limit)throw new Error(`File size ${r.byteLength} exceeds bucket limit of ${o.file_size_limit}`);if(o.allowed_mime_types&&o.allowed_mime_types.length>0&&!o.allowed_mime_types.some(g=>g.endsWith("/*")?s.startsWith(g.slice(0,-1)):s===g))throw new Error(`MIME type ${s} is not allowed in this bucket`);let i={eTag:`"${await this.computeETag(r)}"`,size:r.byteLength,mimetype:s,cacheControl:a?.cacheControl??"max-age=3600",lastModified:new Date().toISOString(),contentLength:r.byteLength,httpStatusCode:200},u=a?.upsert??!1,l;u?l=await this.db.query(`INSERT INTO storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
         VALUES ($1, $2, $3, $4, $5, gen_random_uuid()::text)
         ON CONFLICT (bucket_id, name)
         DO UPDATE SET
           metadata = $4,
           user_metadata = $5,
           updated_at = now(),
           last_accessed_at = now(),
           version = gen_random_uuid()::text,
           owner_id = EXCLUDED.owner_id
         RETURNING *`,[e,t,a?.ownerId??null,JSON.stringify(i),a?.userMetadata?JSON.stringify(a.userMetadata):null]):l=await this.db.query(`INSERT INTO storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
         VALUES ($1, $2, $3, $4, $5, gen_random_uuid()::text)
         RETURNING *`,[e,t,a?.ownerId??null,JSON.stringify(i),a?.userMetadata?JSON.stringify(a.userMetadata):null]);let d=l.rows[0];if(!d)throw new Error("Failed to create object");let f=`${e}/${t}`;return await this.backend.put(f,r,{contentType:s,size:r.byteLength,cacheControl:a?.cacheControl}),d}async downloadObject(e,t){await this.initialize();let s=(await this.db.query(`UPDATE storage.objects
       SET last_accessed_at = now()
       WHERE bucket_id = $1 AND name = $2
       RETURNING *`,[e,t])).rows[0];if(!s)return null;let a=`${e}/${t}`,o=await this.backend.get(a);return o?{data:o.data,metadata:o.metadata,object:s}:null}async getObjectInfo(e,t){return await this.initialize(),(await this.db.query("SELECT * FROM storage.objects WHERE bucket_id = $1 AND name = $2",[e,t])).rows[0]??null}async objectExists(e,t){return await this.initialize(),(await this.db.query("SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2) as exists",[e,t])).rows[0]?.exists??!1}async removeObjects(e,t){if(await this.initialize(),t.length===0)return[];let r=t.map((a,o)=>`$${o+2}`).join(", "),s=await this.db.query(`DELETE FROM storage.objects
       WHERE bucket_id = $1 AND name IN (${r})
       RETURNING *`,[e,...t]);for(let a of s.rows)await this.backend.delete(`${e}/${a.name}`);return s.rows}async listObjects(e,t){await this.initialize();let r=t?.prefix??"",s=t?.limit??100,a=t?.offset??0,o=t?.sortBy?.column??"name",i=t?.sortBy?.order?.toLowerCase()==="desc"?"DESC":"ASC",l=["name","created_at","updated_at","last_accessed_at"].includes(o)?o:"name",d=r?`${r}%`:"%";return(await this.db.query(`SELECT * FROM storage.objects
       WHERE bucket_id = $1 AND name LIKE $2
       ORDER BY ${l} ${i}
       LIMIT $3 OFFSET $4`,[e,d,s,a])).rows}async moveObject(e,t,r,s){await this.initialize();let a=s??e;if((await this.db.query(`UPDATE storage.objects
       SET bucket_id = $3, name = $4, updated_at = now()
       WHERE bucket_id = $1 AND name = $2`,[e,t,a,r])).rowCount===0)throw new Error("Object not found");let i=`${e}/${t}`,u=`${a}/${r}`;await this.backend.copy(i,u)&&await this.backend.delete(i)}async copyObject(e,t,r,s){await this.initialize();let a=s??e,i=(await this.db.query("SELECT * FROM storage.objects WHERE bucket_id = $1 AND name = $2",[e,t])).rows[0];if(!i)throw new Error("Object not found");if(!(await this.db.query(`INSERT INTO storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
       VALUES ($1, $2, $3, $4, $5, gen_random_uuid()::text)
       ON CONFLICT (bucket_id, name)
       DO UPDATE SET
         metadata = EXCLUDED.metadata,
         user_metadata = EXCLUDED.user_metadata,
         updated_at = now(),
         version = gen_random_uuid()::text
       RETURNING *`,[a,r,i.owner_id,JSON.stringify(i.metadata),i.user_metadata?JSON.stringify(i.user_metadata):null])).rows[0])throw new Error("Failed to copy object");let d=`${e}/${t}`,f=`${a}/${r}`;return await this.backend.copy(d,f),`${a}/${r}`}async createSignedUrl(e,t,r){if(await this.initialize(),!await this.objectExists(e,t))throw new Error("Object not found");let a={bucket_id:e,object_name:t,exp:Math.floor(Date.now()/1e3)+r},i=(await this.db.query("SELECT auth.get_signing_key()")).rows[0]?.get_signing_key??crypto.randomUUID(),u=new TextEncoder,l=await crypto.subtle.importKey("raw",u.encode(i),{name:"HMAC",hash:"SHA-256"},!1,["sign"]),d=JSON.stringify(a),f=await crypto.subtle.sign("HMAC",l,u.encode(d)),p=ze(btoa(d)),g=ze(btoa(String.fromCharCode(...new Uint8Array(f))));return`${p}.${g}`}async verifySignedUrl(e){let t=e.split(".");if(t.length!==2)return null;let[r,s]=t;try{let a=atob(Je(r)),o=JSON.parse(a);if(o.exp<Math.floor(Date.now()/1e3))return null;let i=await this.db.query("SELECT auth.get_signing_key()");if(!i.rows[0])return null;let u=new TextEncoder,l=await crypto.subtle.importKey("raw",u.encode(i.rows[0].get_signing_key),{name:"HMAC",hash:"SHA-256"},!1,["verify"]),d=Uint8Array.from(atob(Je(s)),p=>p.charCodeAt(0));return await crypto.subtle.verify("HMAC",l,d,u.encode(a))?o:null}catch{return null}}async computeETag(e){try{let t=e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength),r=await crypto.subtle.digest("SHA-256",t),s=new Uint8Array(r);return Array.from(s.slice(0,8)).map(a=>a.toString(16).padStart(2,"0")).join("")}catch{return Math.random().toString(36).slice(2,18)}}};function w(n,e=200){return new Response(JSON.stringify(n),{status:e,headers:{"Content-Type":"application/json"}})}function fe(n){let e=n.get("Authorization");return!e||!e.startsWith("Bearer ")?null:e.slice(7)}async function Ee(n){try{let e=await n.text();return e?JSON.parse(e):{}}catch{return{}}}async function Te(n,e,t){let r=n.method.toUpperCase(),a=new URL(n.url).searchParams;if(r==="POST"&&e==="/auth/v1/signup"){let o=await Ee(n),i=o.email,u=o.password,l=o.options;if(!i||!u)return w({error:"email and password are required",error_description:"Missing credentials"},400);let d=await t.signUp(i,u,l);return d.error?w({error:d.error.code,error_description:d.error.message},d.error.status):d.data.session?w({access_token:d.data.session.access_token,token_type:d.data.session.token_type,expires_in:d.data.session.expires_in,expires_at:d.data.session.expires_at,refresh_token:d.data.session.refresh_token,user:d.data.user}):w({error:"session_creation_failed",error_description:"Failed to create session"},500)}if(r==="POST"&&e==="/auth/v1/token"){let o=a.get("grant_type");if(o==="password"){let i=await Ee(n),u=i.email,l=i.password;if(!u||!l)return w({error:"invalid_grant",error_description:"Missing credentials"},400);let d=await t.signInWithPassword(u,l);return d.error?w({error:"invalid_grant",error_description:d.error.message},d.error.status):w({access_token:d.data.session.access_token,token_type:d.data.session.token_type,expires_in:d.data.session.expires_in,expires_at:d.data.session.expires_at,refresh_token:d.data.session.refresh_token,user:d.data.user})}if(o==="refresh_token"){let u=(await Ee(n)).refresh_token;if(!u)return w({error:"invalid_grant",error_description:"Missing refresh token"},400);let l=await t.refreshSession(u);return l.error?w({error:"invalid_grant",error_description:l.error.message},l.error.status):w({access_token:l.data.session.access_token,token_type:l.data.session.token_type,expires_in:l.data.session.expires_in,expires_at:l.data.session.expires_at,refresh_token:l.data.session.refresh_token,user:l.data.user})}return w({error:"unsupported_grant_type",error_description:"Grant type not supported"},400)}if(r==="POST"&&e==="/auth/v1/logout"){let o=fe(n.headers),i=await t.signOut(o||void 0);return i.error?w({error:i.error.code,error_description:i.error.message},i.error.status):w({})}if(r==="GET"&&e==="/auth/v1/user"){let o=fe(n.headers);if(!o)return w({error:"unauthorized",error_description:"Missing authorization header"},401);let i=await t.getUser(o);return i.error?w({error:i.error.code,error_description:i.error.message},i.error.status):w(i.data.user)}if(r==="PUT"&&e==="/auth/v1/user"){let o=fe(n.headers);if(!o)return w({error:"unauthorized",error_description:"Missing authorization header"},401);let i=await Ee(n),u=await t.updateUser(o,{email:i.email,password:i.password,data:i.data});return u.error?w({error:u.error.code,error_description:u.error.message},u.error.status):w(u.data.user)}if(r==="GET"&&e==="/auth/v1/session"){let o=fe(n.headers);if(!o)return w({session:null});if((await t.getUser(o)).error)return w({session:null});let u=t.getSession();return w({session:u})}return w({error:"not_found",error_description:"Auth endpoint not found"},404)}async function ne(n,e){if(!e)return await n.exec(J),{role:"anon"};let t=await P(n,e);if(!t.valid||!t.payload)return await n.exec(J),{role:"anon"};let{sub:r,role:s,email:a}=t.payload,o=de(r,s,a||"");return await n.exec(o),{userId:r,role:s,email:a}}async function dt(n){await n.exec(J)}function Ve(n){if(!(n instanceof Error))return{message:"Unknown error occurred",code:"PGRST000"};let e=n;return{message:n.message,code:e.code||"PGRST000",details:e.detail,hint:e.hint}}function Oe(n,e=400){let t=Ve(n);return new Response(JSON.stringify(t),{status:e,headers:{"Content-Type":"application/json"}})}function q(n,e=200,t={}){return new Response(JSON.stringify(n),{status:e,headers:{"Content-Type":"application/json",...t}})}function _t(n){let e=n.get("Authorization");return!e||!e.startsWith("Bearer ")?null:e.slice(7)}async function pt(n){try{let e=await n.text();return e?JSON.parse(e):null}catch{return null}}async function he(n,e,t,r){let s=n.method.toUpperCase(),o=new URL(n.url).searchParams,i=[];o.forEach((p,g)=>{g!=="columns"&&i.push(`${g}=${p}`)});let u=i.join("&"),l=e.split("/").filter(Boolean);if(l.length<3)return q({message:"Invalid path",code:"PGRST000"},400);let d=l.slice(2).join("/"),f=_t(n.headers);try{await ne(t,f);let p,g=null;switch(["POST","PATCH","PUT"].includes(s)&&(g=await pt(n)),s){case"GET":p=r.parseRequest("GET",d,u);break;case"POST":p=r.parseRequest("POST",d,u,g||void 0);break;case"PATCH":p=r.parseRequest("PATCH",d,u,g||void 0);break;case"PUT":p=r.parseRequest("POST",d,u,g||void 0);break;case"DELETE":p=r.parseRequest("DELETE",d,u);break;default:return q({message:"Method not allowed",code:"PGRST105"},405)}let R=p.sql.replace(/RETURNING "\*"/g,"RETURNING *"),y=n.headers.get("Prefer")||"",O=y.includes("return=representation");O&&(s==="POST"||s==="PATCH"||s==="DELETE")&&!R.toUpperCase().includes("RETURNING")&&(R=`${R} RETURNING *`);let U=await t.query(R,[...p.params]),x=y.includes("return=minimal"),Q=y.includes("count=exact")||y.includes("count=planned")||y.includes("count=estimated"),L={};return Q&&(L["Content-Range"]=`0-${U.rows.length-1}/${U.rows.length}`),s==="GET"?q(U.rows,200,L):s==="POST"?x?new Response(null,{status:201,headers:L}):q(U.rows,201,L):s==="PATCH"||s==="PUT"?x?new Response(null,{status:204,headers:L}):O?q(U.rows,200,L):new Response(null,{status:204,headers:L}):s==="DELETE"?O?q(U.rows,200,L):new Response(null,{status:204,headers:L}):q(U.rows,200,L)}catch(p){return Oe(p)}}function I(n,e=200){return new Response(JSON.stringify(n),{status:e,headers:{"Content-Type":"application/json"}})}function m(n,e=400){return I({statusCode:e.toString(),error:n,message:n},e)}function gt(n){let e=n.get("Authorization");return!e||!e.startsWith("Bearer ")?null:e.slice(7)}async function $(n){try{let e=await n.text();return e?JSON.parse(e):{}}catch{return{}}}async function ft(n){let e=n.headers.get("Content-Type")||"";if(e.includes("multipart/form-data")){let r=await n.formData();for(let s of["","file","data"]){let a=r.get(s);if(a instanceof Blob){let o=await a.arrayBuffer();return{data:new Uint8Array(o),contentType:a.type||"application/octet-stream"}}}throw new Error("No file found in form data")}let t=await n.arrayBuffer();return{data:new Uint8Array(t),contentType:e||"application/octet-stream"}}async function me(n,e,t,r){let s=n.method.toUpperCase(),a=gt(n.headers),o=await ne(t,a);await t.exec("RESET ROLE");try{if(e==="/storage/v1/bucket"&&s==="GET")return await Et(r);if(e==="/storage/v1/bucket"&&s==="POST")return await ht(n,r);let i=e.match(/^\/storage\/v1\/bucket\/([^/]+)\/empty$/);if(i&&s==="POST")return await yt(i[1],r);let u=e.match(/^\/storage\/v1\/bucket\/([^/]+)$/);if(u){let Q=u[1];if(s==="GET")return await Tt(Q,r);if(s==="PUT")return await mt(Q,n,r);if(s==="DELETE")return await bt(Q,r)}if(e==="/storage/v1/object/move"&&s==="POST")return await At(n,r);if(e==="/storage/v1/object/copy"&&s==="POST")return await Nt(n,r);let l=e.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);if(l&&s==="POST")return await Ut(l[1],l[2],n,r);let d=e.match(/^\/storage\/v1\/object\/sign\/([^/]+)$/);if(d&&s==="POST")return await It(d[1],n,r);if(e.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/)&&s==="GET"){let L=new URL(n.url).searchParams.get("token");if(L)return await Ot(L,t,r)}let p=e.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);if(p&&s==="GET")return await kt(p[1],p[2],t,r);let g=e.match(/^\/storage\/v1\/object\/info\/([^/]+)\/(.+)$/);if(g&&s==="GET")return await Lt(g[1],g[2],r);let R=e.match(/^\/storage\/v1\/object\/list\/([^/]+)$/);if(R&&s==="POST")return await St(R[1],n,r);let y=e.match(/^\/storage\/v1\/object\/([^/]+)$/);if(y&&s==="DELETE")return await Rt(y[1],n,r);let O=e.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);if(O&&s==="POST")return await Ye(O[1],O[2],n,r,o.userId,!1);if(O&&s==="PUT")return await Ye(O[1],O[2],n,r,o.userId,!0);let U=e.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);if(U&&s==="GET")return await Ke(U[1],U[2],r);if(U&&s==="HEAD")return await wt(U[1],U[2],r);let x=e.match(/^\/storage\/v1\/render\/image\/(?:authenticated|public)\/([^/]+)\/(.+)$/);return x&&s==="GET"?await Ke(x[1],x[2],r):m("Storage endpoint not found",404)}catch(i){let u=i instanceof Error?i.message:"Internal error";return m(u,500)}}async function Et(n){let e=await n.listBuckets();return I(e)}async function Tt(n,e){let t=await e.getBucket(n);return t?I(t):m("Bucket not found",404)}async function ht(n,e){let t=await $(n),r=t.name??t.id;if(!r)return m("Bucket name is required");try{let s=await e.createBucket({id:t.id??r,name:r,public:t.public,file_size_limit:t.file_size_limit,allowed_mime_types:t.allowed_mime_types});return I({name:s.name},200)}catch(s){let a=s instanceof Error?s.message:"Failed to create bucket";return a.includes("duplicate")||a.includes("unique")?m("Bucket already exists",409):m(a,500)}}async function mt(n,e,t){let r=await $(e);try{return await t.updateBucket(n,{public:r.public,file_size_limit:r.file_size_limit,allowed_mime_types:r.allowed_mime_types}),I({message:"Successfully updated"})}catch(s){let a=s instanceof Error?s.message:"Failed to update bucket";return m(a,404)}}async function yt(n,e){try{return await e.emptyBucket(n),I({message:"Successfully emptied"})}catch(t){let r=t instanceof Error?t.message:"Failed to empty bucket";return m(r,500)}}async function bt(n,e){try{return await e.deleteBucket(n),I({message:"Successfully deleted"})}catch(t){let r=t instanceof Error?t.message:"Failed to delete bucket";return r.includes("not empty")?m("Bucket not empty",409):m(r,500)}}async function Ye(n,e,t,r,s,a){t.headers.get("x-upsert")==="true"&&(a=!0);let i=t.headers.get("cache-control")??void 0;try{let{data:u,contentType:l}=await ft(t),d=await r.uploadObject(n,e,u,l,{cacheControl:i,upsert:a,ownerId:s});return I({Id:d.id,Key:`${n}/${e}`})}catch(u){let l=u instanceof Error?u.message:"Upload failed";return l.includes("duplicate")||l.includes("unique")||l.includes("already exists")?m("The resource already exists",409):l.includes("File size")||l.includes("MIME type")?m(l,422):m(l,500)}}async function Ke(n,e,t){let r=await t.downloadObject(n,e);return r?new Response(r.data.buffer.slice(r.data.byteOffset,r.data.byteOffset+r.data.byteLength),{status:200,headers:{"Content-Type":r.metadata.contentType,"Content-Length":r.metadata.size.toString(),"Cache-Control":r.metadata.cacheControl??"max-age=3600",ETag:r.object.metadata?.eTag??""}}):m("Object not found",404)}async function wt(n,e,t){return await t.objectExists(n,e)?new Response(null,{status:200}):new Response(null,{status:404})}async function Rt(n,e,t){let s=(await $(e)).prefixes;if(!s||!Array.isArray(s))return m("prefixes array is required");let a=await t.removeObjects(n,s);return I(a)}async function St(n,e,t){let r=await $(e),s=await t.listObjects(n,{prefix:r.prefix,limit:r.limit,offset:r.offset,sortBy:r.sortBy,search:r.search}),a=r.prefix??"",o=s.map(i=>({name:i.name.startsWith(a)?i.name.slice(a.length):i.name,id:i.id,updated_at:i.updated_at,created_at:i.created_at,last_accessed_at:i.last_accessed_at,metadata:i.metadata}));return I(o)}async function At(n,e){let t=await $(n),r=t.bucketId,s=t.sourceKey,a=t.destinationKey,o=t.destinationBucket;if(!r||!s||!a)return m("bucketId, sourceKey, and destinationKey are required");try{return await e.moveObject(r,s,a,o),I({message:"Successfully moved"})}catch(i){let u=i instanceof Error?i.message:"Move failed";return m(u,500)}}async function Nt(n,e){let t=await $(n),r=t.bucketId,s=t.sourceKey,a=t.destinationKey,o=t.destinationBucket;if(!r||!s||!a)return m("bucketId, sourceKey, and destinationKey are required");try{let i=await e.copyObject(r,s,a,o);return I({Key:i})}catch(i){let u=i instanceof Error?i.message:"Copy failed";return m(u,500)}}async function Ut(n,e,t,r){let a=(await $(t)).expiresIn??3600;try{let o=await r.createSignedUrl(n,e,a),i=`/object/sign/${n}/${e}?token=${o}`;return I({signedURL:i})}catch(o){let i=o instanceof Error?o.message:"Failed to create signed URL";return m(i,500)}}async function It(n,e,t){let r=await $(e),s=r.expiresIn??3600,a=r.paths;if(!a||!Array.isArray(a))return m("paths array is required");let o=await Promise.all(a.map(async i=>{try{let u=await t.createSignedUrl(n,i,s);return{signedURL:`/object/sign/${n}/${i}?token=${u}`,path:i,error:null}}catch(u){let l=u instanceof Error?u.message:"Failed";return{signedURL:null,path:i,error:l}}}));return I(o)}async function Ot(n,e,t){await e.exec("RESET ROLE");let r=await t.verifySignedUrl(n);if(!r)return m("Invalid or expired signed URL",401);let s=await t.downloadObject(r.bucket_id,r.object_name);return s?new Response(s.data.buffer.slice(s.data.byteOffset,s.data.byteOffset+s.data.byteLength),{status:200,headers:{"Content-Type":s.metadata.contentType,"Content-Length":s.metadata.size.toString(),"Cache-Control":s.metadata.cacheControl??"max-age=3600"}}):m("Object not found",404)}async function kt(n,e,t,r){await t.exec("RESET ROLE");let s=await r.getBucket(n);if(!s)return m("Bucket not found",404);if(!s.public)return m("Bucket is not public",400);let a=await r.downloadObject(n,e);return a?new Response(a.data.buffer.slice(a.data.byteOffset,a.data.byteOffset+a.data.byteLength),{status:200,headers:{"Content-Type":a.metadata.contentType,"Content-Length":a.metadata.size.toString(),"Cache-Control":a.metadata.cacheControl??"max-age=3600"}}):m("Object not found",404)}async function Lt(n,e,t){let r=await t.getObjectInfo(n,e);return r?I({id:r.id,name:r.name,bucketId:r.bucket_id,owner:r.owner_id,createdAt:r.created_at,updatedAt:r.updated_at,lastAccessedAt:r.last_accessed_at,metadata:r.metadata,userMetadata:r.user_metadata,version:r.version}):m("Object not found",404)}function Ct(n,e,t){let r=new URL(n.url),s=new URL(e).host;if(r.host!==s)return{intercept:!1,type:"passthrough"};let a=r.pathname;return a.startsWith("/auth/v1/")?{intercept:!0,type:"auth",pathname:a}:a.startsWith("/rest/v1/")?{intercept:!0,type:"data",pathname:a}:t&&a.startsWith("/storage/v1/")?{intercept:!0,type:"storage",pathname:a}:{intercept:!1,type:"passthrough"}}function ye(n){let{db:e,parser:t,authHandler:r,storageHandler:s,supabaseUrl:a,originalFetch:o=globalThis.fetch.bind(globalThis),debug:i=!1}=n,u=i?(...l)=>console.log("[nano-supabase]",...l):()=>{};return async function(d,f){let p=d instanceof Request?d:new Request(d,f),g=Ct(p,a,!!s);if(!g.intercept)return u("Passthrough:",p.method,p.url),o(d,f);let R=p.headers.get("Authorization");console.log("[FETCH_ADAPTER] Intercepting:",{type:g.type,method:p.method,pathname:g.pathname,hasAuth:!!R,authPreview:R?`${R.slice(0,30)}...`:"none"}),u("Intercepting:",g.type,p.method,g.pathname),u("Authorization header:",R?`${R.slice(0,20)}...`:"none");try{let y;if(g.type==="auth"&&g.pathname)y=await Te(p,g.pathname,r);else if(g.type==="data"&&g.pathname)y=await he(p,g.pathname,e,t);else if(g.type==="storage"&&g.pathname&&s)y=await me(p,g.pathname,e,s);else return o(d,f);return u("Response status:",y.status),y}catch(y){u("Error handling request:",y);let O=y instanceof Error?y.message:"Internal error";return new Response(JSON.stringify({error:"internal_error",error_description:O}),{status:500,headers:{"Content-Type":"application/json"}})}}}async function vt(n,e){let{db:t,supabaseUrl:r="http://localhost:54321",supabaseAnonKey:s="local-anon-key",debug:a=!1,originalFetch:o,storageBackend:i}=n;await k.init(),await k.initSchema(async g=>({rows:(await t.query(g)).rows}));let u=new k,l=new F(t);await l.initialize();let d;i!==!1&&(d=new H(t,i||void 0),await d.initialize());let f=ye({db:t,parser:u,authHandler:l,storageHandler:d,supabaseUrl:r,originalFetch:o,debug:a});return{client:e(r,s,{global:{fetch:f}}),authHandler:l,parser:u,storageHandler:d,localFetch:f}}async function xt(n){let e=new F(n);return await e.initialize(),e}async function Pt(n){let{db:e,supabaseUrl:t="http://localhost:54321",debug:r=!1,originalFetch:s,storageBackend:a}=n;await k.init(),await k.initSchema(async d=>({rows:(await e.query(d)).rows}));let o=new k,i=new F(e);await i.initialize();let u;return a!==!1&&(u=new H(e,a||void 0),await u.initialize()),{localFetch:ye({db:e,parser:o,authHandler:i,storageHandler:u,supabaseUrl:t,originalFetch:s,debug:r}),authHandler:i,parser:o,storageHandler:u}}var be=class{db;parser;constructor(e,t){this.db=e,this.parser=t}from(e){return new ke(this.db,this.parser,e)}async rpc(e,t){try{let r=this.parser.parseRpc(e,t);return{data:(await this.db.query(r.sql,[...r.params])).rows,error:null}}catch(r){return{data:null,error:r}}}},ke=class{db;parser;table;selectColumns;filters=[];orderBy;limitCount;offsetCount;insertData;updateData;isDelete=!1;expectSingle=!1;expectMaybeSingle=!1;constructor(e,t,r){this.db=e,this.parser=t,this.table=r}select(e="*"){return this.selectColumns=e,this}insert(e){return this.insertData=e,this}update(e){return this.updateData=e,this}delete(){return this.isDelete=!0,this}eq(e,t){return this.filters.push(`${e}=eq.${String(t)}`),this}neq(e,t){return this.filters.push(`${e}=neq.${String(t)}`),this}gt(e,t){return this.filters.push(`${e}=gt.${String(t)}`),this}gte(e,t){return this.filters.push(`${e}=gte.${String(t)}`),this}lt(e,t){return this.filters.push(`${e}=lt.${String(t)}`),this}lte(e,t){return this.filters.push(`${e}=lte.${String(t)}`),this}like(e,t){return this.filters.push(`${e}=like.${t}`),this}ilike(e,t){return this.filters.push(`${e}=ilike.${t}`),this}in(e,t){let r=t.map(String).join(",");return this.filters.push(`${e}=in.(${r})`),this}is(e,t){let r=t===null?"null":t?"true":"false";return this.filters.push(`${e}=is.${r}`),this}order(e,t){let r=t?.ascending===!1?"desc":"asc",s=t?.nullsFirst?"nullsfirst":"nullslast";return this.orderBy=`${e}.${r}.${s}`,this}limit(e){return this.limitCount=e,this}range(e,t){return this.offsetCount=e,this.limitCount=t-e+1,this}single(){return this.expectSingle=!0,this.limitCount=1,this}maybeSingle(){return this.expectMaybeSingle=!0,this.limitCount=1,this}async then(e){let t=await this.execute();return e?e(t):t}async execute(){try{let e=this.buildQueryString(),t;if(this.insertData!==void 0){let a=Array.isArray(this.insertData)?this.insertData[0]??{}:this.insertData;t=this.parser.parseInsert(this.table,a,e)}else this.updateData!==void 0?t=this.parser.parseUpdate(this.table,this.updateData,e):this.isDelete?t=this.parser.parseDelete(this.table,e):t=this.parser.parseSelect(this.table,e);let r=await this.db.query(t.sql,[...t.params]);if(this.expectSingle&&r.rows.length===0)throw new Error("No rows returned");if(this.expectSingle&&r.rows.length>1)throw new Error("Multiple rows returned");return{data:this.expectSingle||this.expectMaybeSingle?r.rows[0]??null:r.rows,error:null}}catch(e){return{data:null,error:e}}}buildQueryString(){let e=[];return this.selectColumns&&e.push(`select=${this.selectColumns}`),e.push(...this.filters),this.orderBy&&e.push(`order=${this.orderBy}`),this.limitCount!==void 0&&e.push(`limit=${this.limitCount}`),this.offsetCount!==void 0&&e.push(`offset=${this.offsetCount}`),e.join("&")}};async function Ft(n){await k.init(),await k.initSchema(async t=>({rows:(await n.query(t)).rows}));let e=new k;return new be(n,e)}var se=class{queues;maxSize;constructor(e=1e3){this.maxSize=e,this.queues=new Map([[0,[]],[1,[]],[2,[]],[3,[]]])}enqueue(e){let t=this.queues.get(e.priority);if(!t)throw new Error(`Invalid priority: ${e.priority}`);if(this.size()>=this.maxSize)throw new Error("Queue is full");t.push(e)}dequeue(){for(let e of[0,1,2,3]){let t=this.queues.get(e);if(t&&t.length>0)return t.shift()??null}return null}size(){return Array.from(this.queues.values()).reduce((e,t)=>e+t.length,0)}isEmpty(){return this.size()===0}clear(){for(let e of this.queues.values())e.length=0}};var Le=class{db;queue;running=!1;config;sleepTimeoutId=null;constructor(e,t={}){this.db=e,this.queue=new se(t.maxQueueSize??1e3),this.config={maxQueueSize:t.maxQueueSize??1e3,defaultTimeout:t.defaultTimeout??5e3}}async start(){if(this.running)throw new Error("Pooler already started");this.running=!0,setTimeout(()=>{this.processQueue().catch(e=>{console.error("Queue processor error:",e),this.running=!1})},0),await new Promise(e=>setTimeout(e,0))}async stop(){this.running=!1,this.sleepTimeoutId!==null&&(clearTimeout(this.sleepTimeoutId),this.sleepTimeoutId=null),await new Promise(e=>setTimeout(e,20))}async query(e,t,r=2){return new Promise((s,a)=>{let o={id:crypto.randomUUID(),sql:e,params:t??[],priority:r,enqueuedAt:Date.now(),resolve:s,reject:a,timeoutMs:this.config.defaultTimeout};try{this.queue.enqueue(o)}catch(i){a(i instanceof Error?i:new Error(String(i)))}})}async processQueue(){for(;this.running;){let e=this.queue.dequeue();if(!e){await new Promise(t=>{let r=setTimeout(()=>{t(null)},10);this.sleepTimeoutId=r}),this.sleepTimeoutId=null;continue}try{let t=await this.executeWithTimeout(e);e.resolve(t)}catch(t){e.reject(t instanceof Error?t:new Error(String(t)))}}}async executeWithTimeout(e){let t=e.timeoutMs??this.config.defaultTimeout,r=null,s=new Promise((o,i)=>{r=setTimeout(()=>{i(new Error("Query timeout"))},t)}),a=this.db.query(e.sql,e.params).finally(()=>{r&&clearTimeout(r)});return Promise.race([a,s])}};var Ze=(s=>(s[s.CRITICAL=0]="CRITICAL",s[s.HIGH=1]="HIGH",s[s.MEDIUM=2]="MEDIUM",s[s.LOW=3]="LOW",s))(Ze||{});export{le as AUTH_SCHEMA_SQL,F as AuthHandler,J as CLEAR_AUTH_CONTEXT_SQL,Y as MemoryStorageBackend,Le as PGlitePooler,k as PostgrestParser,se as PriorityQueue,Ze as QueryPriority,ge as STORAGE_SCHEMA_SQL,H as StorageHandler,be as SupabaseClient,dt as clearAuthContext,G as createAccessToken,Pt as createFetchAdapter,ye as createLocalFetch,vt as createLocalSupabaseClient,Ft as createSupabaseClient,_e as decodeJWT,Oe as errorResponse,Ve as extractPostgresError,pe as extractSessionIdFromToken,We as extractUserIdFromToken,Xe as generateTokenPair,de as getSetAuthContextSQL,Te as handleAuthRoute,he as handleDataRoute,me as handleStorageRoute,xt as initializeAuth,ne as setAuthContext,Ue as signJWT,P as verifyAccessToken,Ie as verifyJWT};
//# sourceMappingURL=index.js.map
