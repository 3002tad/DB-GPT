const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
function bridge(){
 const file=path.resolve(__dirname,'../new-components/dashboard/dashboard-i18n.ts');
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const i18n={isInitialized:true,language:'vi',resolvedLanguage:'vi'};
 const context={exports:{},require:name=>{
  if(name==='i18next')return i18n;
  if(name==='@/locales/en/dashboard')return {'总数':'Total {{count}}','标题':'Dashboard'};
  if(name==='@/locales/vi/ui-text')return {viUiText:{'Total {{count}}':'Tổng {{count}}'},translateDynamicVi:()=>undefined};
  if(name==='react-i18next')return {useTranslation:()=>({i18n})};
  throw Error(name);
 }};
 vm.runInNewContext(js,context,{filename:file});return context.exports;
}
test('Vietnamese dashboard bridge interpolates translated templates',()=>assert.equal(bridge().dashboardText('总数',{count:42}),'Tổng 42'));
test('Vietnamese interpolation preserves zero',()=>assert.equal(bridge().dashboardText('总数',{count:0}),'Tổng 0'));
test('untranslated upstream copy falls back to English',()=>assert.equal(bridge().dashboardText('标题'),'Dashboard'));
test('dashboard date formatting respects Vietnamese',()=>assert.equal(bridge().dashboardDateLocale(),'vi-VN'));

