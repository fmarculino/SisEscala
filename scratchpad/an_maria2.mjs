import { all } from './an_duplicados.mjs'
const id = '02438af7-25d8-4f33-8f75-990db682249f'
const em = await all(`escala_mensal?select=id,mes,ano,status,unidade_id,setor_id,unidades(nome)&servidor_id=eq.${id}`)
console.log('escalas do 65567:', em.length)
for (const e of em) console.log(`  ${e.mes}/${e.ano} ${e.status} - ${e.unidades?.nome}`)
const fp = await all(`folha_ponto?select=id,mes,ano,status&servidor_id=eq.${id}`)
console.log('folhas:', fp.length, fp.map(f=>`${f.mes}/${f.ano} ${f.status}`).join(', ') || '-')
const mp = await all(`marcacoes_ponto?select=id&servidor_id=eq.${id}`)
console.log('batidas:', mp.length)
const rv = await all(`rep_vinculos_servidor?select=id,dispositivo_id,vigente_ate,dispositivos_rep(nome)&servidor_id=eq.${id}`)
console.log('vinculos REP:', rv.map(v=>`${v.dispositivos_rep?.nome}${v.vigente_ate?' (encerrado)':''}`).join(', ') || '-')
