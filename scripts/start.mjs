import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root=resolve(import.meta.dirname,'..'),directory=join(root,'data'),infoFile=join(directory,'server-info.json');
mkdirSync(directory,{recursive:true});
const info=()=>{try{return JSON.parse(readFileSync(infoFile,'utf8'));}catch{return null;}};
async function healthy(value) {
  if(!value||!/^http:\/\/127\.0\.0\.1:\d+$/.test(value.url)) return false;
  try {
    const result=await (await fetch(value.url+'/api/health',{signal:AbortSignal.timeout(1500)})).json();
    return result.application==='Content OS'&&result.pid===value.pid;
  } catch {return false;}
}
let current=info();
if(!await healthy(current)) {
  if(!existsSync(join(root,'node_modules','express'))) throw Error('请在项目目录运行 npm install，再启动。');
  const stdout=openSync(join(directory,'server.stdout.log'),'a'),stderr=openSync(join(directory,'server.stderr.log'),'a');
  // 使用系统分配的本机端口，后台进程不弹出额外终端窗口。
  const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,detached:true,windowsHide:true,env:{...process.env,PORT:'0',CONTENT_OS_DATA:directory},stdio:['ignore',stdout,stderr]});
  child.unref();closeSync(stdout);closeSync(stderr);
  let ready=false;
  for(let attempt=0;attempt<32;attempt++) {
    await new Promise(resolve=>setTimeout(resolve,250));
    current=info();
    if(current?.pid===child.pid&&await healthy(current)) {ready=true;break;}
  }
  if(!ready) throw Error('服务未通过健康检查，请查看 data/server.stderr.log。');
}
console.log('Content OS MVP 已启动：'+current.url);
if(!process.argv.includes('--no-browser')) {
  const browser=spawn('cmd.exe',['/d','/c','start','',current.url],{windowsHide:true,stdio:'ignore'});
  browser.unref();
}
