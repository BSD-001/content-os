import { readdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const files=['server.mjs'];
for(const directory of ['lib','public','scripts','test']) for(const name of readdirSync(join(root,directory))) if(/\.m?js$/.test(name)) files.push(join(directory,name));
for(const file of files) {
  const result=spawnSync(process.execPath,['--check',join(root,file)],{encoding:'utf8',windowsHide:true});
  if(result.status!==0) {process.stderr.write(result.stderr);process.exit(1);}
}
console.log('语法检查通过：'+files.length+' 个源文件');
