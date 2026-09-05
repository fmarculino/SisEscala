import { AlertTriangle } from 'lucide-react'

/**
 * Aviso de que a consulta do relatorio nao veio inteira.
 *
 * ⚠️ EXISTE POR CAUSA DA ARMADILHA 22 (relatar o que foi calculado em vez do que ha).
 *   `buscarTodasPaginas` interrompe a paginacao quando uma pagina falha e devolve o que ja veio.
 *   Sem este aviso, o relatorio somaria o pedaco como se fosse o total — que e exatamente o
 *   defeito silencioso que a paginacao acabou de fechar, so que por outra porta.
 *
 *   O erro nao e engolido: quem falha ja registrou em `console.error`. O que este componente
 *   garante e que a falha chegue a QUEM ESTA OLHANDO O NUMERO, nao so ao log do servidor.
 */
export function AvisoDadosIncompletos({ completo }: { completo: boolean }) {
  if (completo) return null
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
      <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
      <div className="text-sm text-red-800 dark:text-red-300">
        <p className="font-black uppercase tracking-wider text-xs mb-1">Relatório incompleto</p>
        <p className="leading-relaxed">
          A busca dos dados falhou no meio e os números abaixo <span className="font-bold">não cobrem todo o período</span>.
          Recarregue a página; se persistir, não use estes totais para decisão e avise a TI.
        </p>
      </div>
    </div>
  )
}
