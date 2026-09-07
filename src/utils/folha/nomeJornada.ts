/**
 * O nome da jornada como fonte de horário — normalização única do separador.
 *
 * 🚨 POR QUE ISTO EXISTE (06/09/2026). O horário previsto de quem tem jornada `Regular` sai do
 * NOME dela (`08H ÀS 18H`), por regex — é o nível 3 da cascata de precedência, e renomear uma
 * jornada quebra o cálculo de presença. O problema é que essa leitura estava espalhada por
 * **14 sítios**, cada um com o seu regex, e **12 deles não aceitavam `Á` (A agudo)**:
 *
 *   `08H ÁS 20H` e `09H ÁS 21H` estão no catálogo de jornadas e são selecionáveis no cadastro.
 *
 * Com `Á`, o regex de `parseJornadaNome` (folha-ponto/actions.ts e consultar-escala/actions.ts)
 * não casa e cai no **default de 08:00–17:00**. Numa jornada que vai até 20:00, isso são
 * **3h de hora extra fabricadas por dia, em silêncio** — a folha não avisa, o build não avisa,
 * e ninguém confere um número que "sempre foi assim".
 *
 * ⚠️ O ATRASO já estava protegido, e a distinção importa: `previstoDaJornada` (calculoDia.ts)
 * devolve `null` quando não sabe, então dia sem previsto simplesmente não é medido. Quem cai no
 * default é a HORA EXTRA. Ao mexer aqui, mantenha essa assimetria — inventar previsto para medir
 * atraso é muito pior que não medir.
 *
 * ⚠️ A NORMALIZAÇÃO PRESERVA A CAIXA, e não é detalhe: metade dos regex do projeto não tem a
 * flag `/i` e só casa `AS` maiúsculo (`ScaleGrid`, `complianceEngine`). Mapear tudo para `a`
 * minúsculo consertaria o `Á` e **quebraria** esses — trocaria um bug por outro.
 */

/**
 * Troca o acento do separador por um `a` de mesma caixa, para o nome casar com qualquer um dos
 * regex já espalhados pelo projeto.
 *
 *   `08H ÁS 20H` → `08H AS 20H`      (casa com /(?:AS|ÀS|A)/ sem flag i)
 *   `08h às 20h` → `08h as 20h`      (casa com /(?:às|as|to|-|a)/i)
 *
 * Só o separador é afetado — dígitos, `H` e espaços passam intactos.
 */
export function normalizarNomeJornada(nome: string | null | undefined): string {
  if (!nome) return ''
  return nome.replace(/[ÀÁÂÃ]/g, 'A').replace(/[àáâã]/g, 'a')
}
