const fs=require('fs')
const p='src/app/(dashboard)/ajuda/conteudo/ponto.ts'
let s=fs.readFileSync(p,'utf8')
const usaCrlf=s.includes('\r\n'); const nl=t=>usaCrlf?t.replace(/\n/g,'\r\n'):t
const velho=nl(`        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Horário de batida real é protegido',`)
const c=s.split(velho).length-1
if(c!==1){console.error('ABORT:',c,'ocorrencias');process.exit(1)}
s=s.replace(velho,()=>nl(`        {
          tipo: 'aviso',
          tom: 'atencao',
          titulo: 'Se aparecer "Listagem incompleta"',
          texto:
            'Uma tarja vermelha no topo avisa quando a lista não veio inteira do servidor. Enquanto ela estiver lá, o status das linhas **pode estar errado** — uma folha já gerada pode aparecer como "Não Gerada". **Recarregue a página antes de gerar qualquer coisa**; se o aviso continuar, fale com a TI. Sem esse aviso, você geraria de novo a mesma folha sem saber.',
        },
        {
          tipo: 'aviso',
          tom: 'cuidado',
          titulo: 'Horário de batida real é protegido',`))
fs.writeFileSync(p,s)
console.log('manual ok')
