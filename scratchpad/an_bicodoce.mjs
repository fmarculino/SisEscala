import { all } from './an_duplicados.mjs'
const u = await all("unidades?select=id,nome&nome=ilike.*bico*doce*")
console.log('unidade:', u)
if (u[0]) {
  const d = await all(`dispositivos_rep?select=id,nome,ativo&unidade_id=eq.${u[0].id}`)
  console.log('relogios no Bico Doce:', d.length ? d.map(x=>x.nome+(x.ativo?'':' (inativo)')).join(', ') : 'nenhum')
  const s = await all(`setores?select=id,dicionario_setores(nome),ativo&unidade_id=eq.${u[0].id}`)
  console.log('setores:', s.map(x=>x.dicionario_setores?.nome).join(' | '))
}
