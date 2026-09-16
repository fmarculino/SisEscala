// Torna AvisoDadosIncompletos reutilizavel (titulo/mensagem opcionais) para a Folha de Ponto
// usar o mesmo componente das 4 telas de relatorio (15/09/2026, v2.62.0).
// ATENCAO: o gerador de 05/09 chama-se gen_aviso_incompleto.js — nao sobrescreva aquele.
const fs=require('fs')
const crlf=t=>t.replace(/\n/g,'\r\n')
function edit(p,pares){
  let s=fs.readFileSync(p,'utf8')
  const usaCrlf=s.includes('\r\n')
  for(const [rot,velho,novo] of pares){
    const v=usaCrlf?crlf(velho):velho, n=usaCrlf?crlf(novo):novo
    const c=s.split(v).length-1
    if(c!==1){console.error(`ABORT ${p} / ${rot}: ${c} ocorrencias`);process.exit(1)}
    s=s.replace(v,()=>n)
  }
  fs.writeFileSync(p,s)
  console.log('ok',p)
}

// 1) componente ganha titulo/mensagem opcionais (as 4 telas de relatorio nao mudam)
edit('src/app/(dashboard)/relatorios/_components/AvisoDadosIncompletos.tsx',[
 ['assinatura',
`export function AvisoDadosIncompletos({ completo }: { completo: boolean }) {
  if (completo) return null`,
`export function AvisoDadosIncompletos({
  completo,
  titulo = 'Relatório incompleto',
  mensagem,
}: {
  completo: boolean
  titulo?: string
  mensagem?: React.ReactNode
}) {
  if (completo) return null`],
 ['corpo',
`        <p className="font-black uppercase tracking-wider text-xs mb-1">Relatório incompleto</p>
        <p className="leading-relaxed">
          A busca dos dados falhou no meio e os números abaixo <span className="font-bold">não cobrem todo o período</span>.
          Recarregue a página; se persistir, não use estes totais para decisão e avise a TI.
        </p>`,
`        <p className="font-black uppercase tracking-wider text-xs mb-1">{titulo}</p>
        <p className="leading-relaxed">
          {mensagem ?? (
            <>
              A busca dos dados falhou no meio e os números abaixo <span className="font-bold">não cobrem todo o período</span>.
              Recarregue a página; se persistir, não use estes totais para decisão e avise a TI.
            </>
          )}
        </p>`],
])
