import {readFileSync} from 'node:fs';
export function legacyFromArchive(bytes:Buffer){
  const magic=Buffer.from('USEECARD_BACKUP_V2\n');
  if(!bytes.subarray(0,magic.length).equals(magic))throw new Error('测试归档格式无效');
  const length=bytes.readUInt32BE(magic.length),offset=magic.length+4+length;
  const manifest=JSON.parse(bytes.subarray(magic.length+4,offset).toString()) as {meta:unknown};
  return {format:'ccm-backup',version:1,appVersion:'2.0.0',meta:manifest.meta,databaseBase64:bytes.subarray(offset).toString('base64')};
}
export function legacyFromFile(path:string){return legacyFromArchive(readFileSync(path));}
