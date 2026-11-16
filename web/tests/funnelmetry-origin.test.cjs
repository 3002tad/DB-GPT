const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const file=path.resolve(__dirname,'../next.config.js');
function config(env){
 const context={module:{exports:{}},process:{env},__dirname:path.dirname(file),require:name=>name==='path'?path:class Plugin{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});
 return context.module.exports;
}
test('static export uses public same-origin requests by default',()=>assert.equal(config({DBGPT_WEB_STATIC_EXPORT:'1'}).env.API_BASE_URL,''));
test('development keeps configurable local API default',()=>assert.equal(config({}).env.API_BASE_URL,'http://127.0.0.1:5670'));
test('explicit empty origin is preserved in development',()=>assert.equal(config({API_BASE_URL:''}).env.API_BASE_URL,''));
test('explicit public origin loses trailing slashes',()=>assert.equal(config({DBGPT_WEB_STATIC_EXPORT:'1',API_BASE_URL:'https://ai.example.test/'}).env.API_BASE_URL,'https://ai.example.test'));
test('integration build preserves identity flags and TypeScript checking',()=>{
 const c=config({DBGPT_WEB_STATIC_EXPORT:'1',NEXT_PUBLIC_FUNNELMETRY_IDENTITY:'1',NEXT_PUBLIC_FUNNELMETRY_UI_ORIGIN:'https://analyst.example.test'});
 assert.equal(c.env.NEXT_PUBLIC_FUNNELMETRY_IDENTITY,'1');
 assert.equal(c.env.NEXT_PUBLIC_FUNNELMETRY_UI_ORIGIN,'https://analyst.example.test');
 assert.equal(c.typescript.ignoreBuildErrors,false);
});
