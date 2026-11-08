#!/usr/bin/env python3
"""Prepare immutable attachment blobs and an Inbox v3 manifest; no credentials/network."""
import argparse,base64,hashlib,json,re,unicodedata
from pathlib import Path
MAX_TOTAL=20*1024*1024
CHUNK=256*1024

def valid_path(path,markdown=False):
    if not isinstance(path,str) or not path or unicodedata.normalize('NFC',path)!=path or len(path.encode())>800 or re.search(r'[\\%:#?\x00-\x1f\x7f]',path):
        raise ValueError('Ruta relativa no válida')
    parts=path.split('/')
    for part in parts:
        if not part or part.startswith('.') or part.strip()!=part or part.endswith((' ','.')) or len(part.encode())>180 or re.search(r'[<>"|*]',part) or re.match(r'^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)',part,re.I):
            raise ValueError('Componente de ruta no válido')
    if markdown and not path.endswith('.md'):raise ValueError('La nota debe terminar en .md')
    return path

def prepare(spec,out):
    if not re.fullmatch(r'[a-zA-Z0-9-]{1,100}',spec['id']):raise ValueError('ID no válido')
    if not 1<=len(spec['files'])<=32:raise ValueError('De 1 a 32 archivos')
    out.mkdir(parents=True,exist_ok=True)
    job={'version':3,'id':spec['id'],'operation':'attachments','files':[]};uploads={};total=0;paths=set()
    for item in spec['files']:
        path=valid_path(item['path']);key=path.lower()
        if key in paths:raise ValueError('Destinos repetidos')
        paths.add(key);source=Path(item['source'])
        if not source.is_file():raise ValueError('No se encuentra el archivo original')
        if total+source.stat().st_size>MAX_TOTAL:raise ValueError('Máximo 20 MiB por solicitud')
        with source.open('rb') as f:raw=f.read(MAX_TOTAL+1)
        total+=len(raw)
        if total>MAX_TOTAL:raise ValueError('El archivo cambió de tamaño o supera el límite')
        chunks=[]
        for offset in range(0,len(raw),CHUNK):
            part=raw[offset:offset+CHUNK];sha=hashlib.sha1(b'blob '+str(len(part)).encode()+b'\0'+part).hexdigest()
            chunks.append({'sha':sha,'size':len(part)})
            if sha not in uploads:
                local=out/(sha+'.b64');local.write_text(base64.b64encode(part).decode('ascii'))
                uploads[sha]={'sha':sha,'size':len(part),'base64Path':str(local.resolve()),'repositoryPath':f"chatgpt-inbox/attachments/{spec['id']}/{sha}.blob"}
        job['files'].append({'path':path,'size':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'chunks':chunks})
    if 'note' in spec:
        note=spec['note'];valid_path(note['path'],True)
        if note['path'].lower() in paths or '<!-- chatgpt-inbox-' in note['content']:raise ValueError('Nota de destino no válida')
        job['note']={'path':note['path'],'content':note['content']}
    if len(json.dumps(job,ensure_ascii=False).encode())>131072:raise ValueError('Manifiesto demasiado grande')
    (out/'manifest.json').write_text(json.dumps(job,ensure_ascii=False,indent=2)+'\n')
    (out/'uploads.json').write_text(json.dumps(list(uploads.values()),ensure_ascii=False,indent=2)+'\n')
    return job,list(uploads.values())

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('spec',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    job,uploads=prepare(json.loads(a.spec.read_text()),a.output)
    print(json.dumps({'id':job['id'],'files':len(job['files']),'blobs':len(uploads),'bytes':sum(f['size'] for f in job['files'])}))
