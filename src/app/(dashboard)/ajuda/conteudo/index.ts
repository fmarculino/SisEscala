/**
 * ============================================================================
 * O MANUAL DO SISESCALA — conteúdo
 * ============================================================================
 *
 * 🚨 **ESTE MANUAL FAZ PARTE DO SISTEMA, NÃO É UM ANEXO.**
 *
 * Toda alteração que muda o que o usuário vê ou faz — tela nova, aba nova, botão que sai, regra
 * que passa a recusar algo, mensagem que muda de sentido — **precisa passar por aqui, no mesmo
 * commit**. Um manual que descreve o sistema do mês passado é pior que não ter manual: ele ensina
 * o caminho errado com a autoridade de documentação oficial, e quem o segue conclui que o sistema
 * está quebrado.
 *
 * A regra está registrada no `CLAUDE.md`, na seção "O manual do usuário".
 *
 * ## Como escrever aqui
 *
 * O público é **o coordenador da unidade**, não quem desenvolve. Isso decide o vocabulário:
 *
 *   - fale do que se vê na tela ("a célula fica protegida"), nunca da implementação ("o trigger
 *     recusa o UPDATE");
 *   - nome de tabela, função e migration **não entram** — nem em nota de rodapé;
 *   - explique o **porquê** junto com o **como**. Quem entende a razão da trava para de tentar
 *     contorná-la, e é a razão que faz a regra ser lembrada;
 *   - todo aviso de `cuidado` deve descrever uma consequência real e concreta. Aviso genérico
 *     ensina o leitor a ignorar os avisos;
 *   - prefira número medido a adjetivo. "Mais de 60 códigos" vale mais que "vários códigos".
 *
 * ## Estrutura
 *
 * Capítulo → seções → blocos. Os tipos de bloco estão em `../tipos.ts`; a aparência de cada um,
 * em `../Blocos.tsx`. Nunca escreva HTML no conteúdo: um tipo de bloco = uma aparência no manual
 * inteiro, e é isso que mantém a tela consistente à medida que o texto cresce.
 *
 * ## Ordem dos capítulos
 *
 * É a ordem de quem está aprendendo: entender o sistema, entender o ciclo do mês, depois cada
 * ferramenta, depois a área do servidor, e por fim as dúvidas. Quem já conhece usa a busca.
 */

import type { Capitulo } from '../tipos'
import { comeceAqui } from './comece-aqui'
import { cicloDoMes } from './ciclo-do-mes'
import { escalas } from './escalas'
import { ponto } from './ponto'
import { pessoas } from './pessoas'
import { gestao } from './gestao'
import { servidor } from './servidor'
import { duvidas } from './duvidas'

export const MANUAL: Capitulo[] = [
  comeceAqui,
  cicloDoMes,
  escalas,
  ponto,
  pessoas,
  gestao,
  servidor,
  duvidas,
]

/** Todas as seções em sequência, na ordem do manual — usado pela busca e pelo "próxima seção". */
export const TODAS_AS_SECOES = MANUAL.flatMap(cap =>
  cap.secoes.map(sec => ({ capitulo: cap, secao: sec }))
)
