import { U, H, all } from './an_duplicados.mjs'
const sv = await all('servidores?select=id,nome,matricula,cpf,status,unidade_id,setor_id,motivo_inativacao,vinculo_multiplo_confirmado,unidades(nome)&cpf=in.(93052707272,930.527.072-72)')
for (const s of sv) console.log(`${s.matricula.padEnd(10)} ${s.status.padEnd(8)} vm=${s.vinculo_multiplo_confirmado?'S':'n'} | ${s.unidades?.nome} | motivo: ${s.motivo_inativacao||'-'} | id ${s.id}`)
// A migration ja esta aplicada?
const r = await fetch(`${U}/rest/v1/rpc/fn_cadastros_duplicados`, { method:'POST', headers:{...H,'Content-Type':'application/json'}, body:'{}' })
console.log('\nfn_cadastros_duplicados ->', r.status, (await r.text()).slice(0,120))
const r2 = await fetch(`${U}/rest/v1/servidores?select=id,mesclado_em_servidor_id&limit=1`, { headers: H })
console.log('coluna mesclado_em_servidor_id ->', r2.status, (await r2.text()).slice(0,120))
