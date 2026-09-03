import fs from 'fs'
import { rpc } from './q.mjs'
const { semSaida, semEntrada } = JSON.parse(fs.readFileSync('scratchpad/_cruza.json','utf8'))
const F=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
const alvos=[...semSaida.map(x=>({...x,falta:'saida'})), ...semEntrada.map(x=>({...x,falta:'entrada'}))]
const cache=new Map()
const proj=async(sv,d)=>{const k=sv+'|'+d; if(!cache.has(k)) cache.set(k, await rpc('fn_projecao_marcacoes_dia',{p_servidor_id:sv,p_data:d})); return cache.get(k)}
const recuperaveis=[], naoBateu=[]
for(const a of alvos){
  const data=`2026-${String(Number(a.comp.slice(5)))
    .padStart(2,'0')}-${String(a.dia).padStart(2,'0')}`
  const p = await proj(a.sv, data)
  if(!Array.isArray(p)) { console.log('ERRO', p); continue }
  const linha = p.find(x=>x.escala_diaria_id===a.edId)
  const tem = linha && (a.falta==='saida' ? linha.saida_em : linha.entrada_em)
  if(tem) recuperaveis.push({...a, valor:F(tem), data})
  else naoBateu.push({...a, data})
}
console.log('RECUPERAVEIS (a projecao ja tem o passo, so falta gravar):', recuperaveis.length)
console.log('SEM BATIDA MESMO (nada a recuperar):', naoBateu.length)
const pc={}; for(const r of recuperaveis){const k=`${r.comp} ${r.falta}`; pc[k]=(pc[k]||0)+1}
console.log(pc)
console.log('\n-- recuperaveis:')
for(const r of recuperaveis) console.log(` ${r.comp} d${String(r.dia).padStart(2)} ${r.cat.padEnd(8)} ${String(r.mat).padEnd(6)} ${(r.nome||'').slice(0,24).padEnd(24)} falta ${r.falta.padEnd(7)} -> ${r.valor}`)
fs.writeFileSync('scratchpad/_recuperaveis.json',JSON.stringify(recuperaveis,null,1))
