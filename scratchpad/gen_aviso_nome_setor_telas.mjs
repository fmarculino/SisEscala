/**
 * Gerador: insere o aviso de nome parecido nas DUAS telas que gravam nome de setor.
 *
 * As duas ja divergiram antes (o EditSetorForm descartava o retorno da action e prendia o botao em
 * "Processando..."; o NovoSetorForm ganhou a correcao depois). Por isso a insercao e' mecanica e
 * conferida por contagem, nunca digitada duas vezes.
 */
import fs from 'node:fs'

const ALVOS = [
  'src/app/(dashboard)/setores/novo/NovoSetorForm.tsx',
  'src/app/(dashboard)/setores/[id]/EditSetorForm.tsx',
]

for (const p of ALVOS) {
  let s = fs.readFileSync(p, 'utf8')
  const EOL = s.includes('\r\n') ? '\r\n' : '\n'
  const eol = t => t.split('\n').join(EOL)

  const sub = (deBruto, paraBruto, n = 1) => {
    const de = eol(deBruto), para = eol(paraBruto)
    const achou = s.split(de).length - 1
    if (achou !== n) {
      console.error(`ABORTA em ${p}: trecho achado ${achou}x, esperado ${n}x:\n---\n${de.slice(0, 140)}\n---`)
      process.exit(1)
    }
    s = s.split(de).join(para)
  }

  // 1) import do componente
  sub(
    `import { formatSectorsHierarchy } from '@/utils/sectors'`,
    `import { formatSectorsHierarchy } from '@/utils/sectors'
import { AvisoNomeSetorParecido } from '@/components/setores/AvisoNomeSetorParecido'`,
  )

  // 2) estado da confirmacao
  sub(
    `  const [erro, setErro] = useState<string | null>(null)`,
    `  const [erro, setErro] = useState<string | null>(null)
  // ⚠️ Zera a cada nome digitado (ver o onChange do input): marcar, trocar o nome e enviar
  // passaria sem que a nova lista de parecidos tivesse sido vista.
  const [confirmadoNomeNovo, setConfirmadoNomeNovo] = useState(false)`,
  )

  // 3) trocar o nome desfaz a confirmacao
  sub(
    `              onChange={(e) => setNomeSetor(e.target.value.toUpperCase())}`,
    `              onChange={(e) => { setNomeSetor(e.target.value.toUpperCase()); setConfirmadoNomeNovo(false) }}`,
  )

  // 4) o aviso, logo depois do campo de nome — a ancora e' o fim do selo "Padronizado", que e' o
  //    ultimo elemento dentro do bloco do input nas duas telas (o que vem DEPOIS difere: a tela
  //    de criacao tem as sugestoes rapidas, a de edicao vai direto para a nota de rodape).
  sub(
    `                </span>
              </div>
            )}
          </div>`,
    `                </span>
              </div>
            )}
          </div>

          <AvisoNomeSetorParecido
            nome={nomeSetor}
            nomesExistentes={nomesPadronizados}
            confirmado={confirmadoNomeNovo}
            onConfirmar={setConfirmadoNomeNovo}
            onUsarExistente={(nome) => { setNomeSetor(nome); setConfirmadoNomeNovo(false) }}
          />`,
  )

  // invariantes desta tela
  const invariantes = [
    [`setConfirmadoNomeNovo(false)`, 2, 'a confirmacao e zerada ao digitar e ao usar o existente'],
    [`name="confirmar_nome_novo"`, 0, 'o campo vive no componente, nunca duplicado na tela'],
    [`resultado?.error`, 1, 'o tratamento do retorno da action continua no lugar'],
  ]
  for (const [trecho, esperado, descricao] of invariantes) {
    const achou = s.split(trecho).length - 1
    if (achou !== esperado) {
      console.error(`ABORTA invariante em ${p} (${descricao}): ${achou}x, esperado ${esperado}x`)
      process.exit(1)
    }
  }

  fs.writeFileSync(p, s)
  console.log(`${p}: 4 substituicoes, 3 invariantes conferidos`)
}
