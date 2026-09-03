import fs from 'fs'
import { get } from './q.mjs'
const casos = JSON.parse(fs.readFileSync('scratchpad/_sobrep.json','utf8'))
const dts = await get(`dicionario_turnos?select=id,codigo,slots,horas_computadas,horario_inicio`)
const DTc = Object.fromEntries(dts.map(d=>[d.codigo,d]))
const parseHM = s => { const m=/(\d{2}):(\d{2})/.exec(s); return +m[1]*60+ +m[2] }
const janela = txt => { const [a,b]=txt.split('-'); const d1=a.split(',')[0].trim(), d2=b.split(',')[0].trim()
  return [parseHM(a), parseHM(b) + (d1!==d2?1440:0)] }
const sobrepoe=([a1,a2],[b1,b2])=> a1<b2 && a2>b1
let resolvidos=0, persistem=0, semAncora=0; const rest=[]
for(const c of casos){
  const dt = DTc[c.cod]
  if(!dt || !dt.horario_inicio){ semAncora++; rest.push({...c, motivo:'sem ancora no dicionario (Classe B)'}); continue }
  const ini=+dt.horario_inicio.slice(0,2)*60, fim=ini+Number(dt.horas_computadas)*60
  if(!sobrepoe([ini,fim], janela(c.reg))) resolvidos++
  else { persistem++; rest.push({...c, motivo:`ancora ${dt.horario_inicio.slice(0,5)} tambem sobrepoe`}) }
}
console.log('casos:',casos.length,'\nRESOLVIDOS pela ancora:',resolvidos,'\nPERSISTEM:',persistem,'\nSEM ancora (Classe B):',semAncora)
const agg={}; for(const r of rest){const k=`${r.cod.padEnd(3)} | jornada ${String(r.jornada).padEnd(11)} | ${r.motivo}`; agg[k]=(agg[k]||0)+1}
console.log('\nresiduais:'); for(const [k,v] of Object.entries(agg).sort((a,b)=>b[1]-a[1])) console.log(` ${String(v).padStart(3)}x  ${k}`)
console.log('\ncom ponto entre residuais:', rest.filter(r=>r.ponto).length)
fs.writeFileSync('scratchpad/_residuais.json',JSON.stringify(rest,null,1))
