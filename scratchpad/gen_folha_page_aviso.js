const fs=require('fs')
const p='src/app/(dashboard)/folha-ponto/page.tsx'
let s=fs.readFileSync(p,'utf8')
const usaCrlf=s.includes('\r\n'); const crlf=t=>usaCrlf?t.replace(/\n/g,'\r\n'):t
function sub(rot,velho,novo){
  const v=crlf(velho),n=crlf(novo)
  const c=s.split(v).length-1
  if(c!==1){console.error(`ABORT ${rot}: ${c} ocorrencias`);process.exit(1)}
  s=s.replace(v,()=>n)
}

sub('import',
"import { isFaltaDefinitiva } from '@/utils/folha/faltaAutomatica'",
"import { isFaltaDefinitiva } from '@/utils/folha/faltaAutomatica'\nimport { AvisoDadosIncompletos } from '@/app/(dashboard)/relatorios/_components/AvisoDadosIncompletos'")

sub('estado',
"  const [servidoresData, setServidoresData] = useState<any[]>([])",
"  const [servidoresData, setServidoresData] = useState<any[]>([])\n  // Falso quando a busca da listagem foi interrompida no meio: a linha pode estar mostrando\n  // status de folha ERRADO (\"Nao Gerada\" para folha que existe), nao apenas faltando gente.\n  const [listagemCompleta, setListagemCompleta] = useState(true)")

sub('fetch',
`    } else if (res.servidores) {
      setServidoresData(res.servidores)
    }`,
`    } else if (res.servidores) {
      setServidoresData(res.servidores)
      setListagemCompleta(res.completo !== false)
    }`)

sub('render',
`      {/* Main List Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">`,
`      {!buscaAtiva && (
        <div className="mb-6">
          <AvisoDadosIncompletos
            completo={listagemCompleta}
            titulo="Listagem incompleta"
            mensagem={
              <>
                A busca das folhas falhou no meio, então o status desta lista{' '}
                <span className="font-bold">pode estar errado</span> — uma folha já gerada pode aparecer como
                &quot;Não Gerada&quot;. Recarregue a página antes de gerar qualquer coisa.
              </>
            }
          />
        </div>
      )}

      {/* Main List Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">`)

fs.writeFileSync(p,s)
console.log('ok — 4 substituicoes')
