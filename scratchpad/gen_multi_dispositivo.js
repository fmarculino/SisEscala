// Gerador da v0.9.0 do coletor: uma maquina passa a coletar VARIOS relogios.
//
// Substituicao mecanica com contagem — aborta se qualquer padrao nao aparecer exatamente as
// vezes esperadas, mesma disciplina dos geradores de funcao plpgsql do projeto. Sem isso, uma
// funcao do ciclo ficaria para tras ainda lendo cfg.DispositivoRep (o relogio legado) e
// sincronizaria sempre o mesmo equipamento, em silencio.
const fs = require('fs')

const alvo = 'tools/coletor-rep/ciclo/ciclo.go'
let src = fs.readFileSync(alvo, 'utf8')

function troca(de, para, esperado) {
  const partes = src.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    console.error(`ABORTADO: ${esperado} ocorrencia(s) esperada(s), ${achou} encontrada(s) para:\n${de}\n`)
    process.exit(1)
  }
  src = partes.join(para)
}

// 1. As cinco funcoes do ciclo passam a receber O relogio, em vez de descobrirem sozinhas qual e'.
const assinaturas = [
  ['func Sync(cfg *config.Config) error {\n\tif cfg.DispositivoRep == nil {\n\t\treturn fmt.Errorf("secao dispositivo_rep ausente no config.yaml — nada para sincronizar")\n\t}\n\td := cfg.DispositivoRep\n',
   'func Sync(cfg *config.Config, d *config.DispositivoRepConfig) error {\n\tif d == nil {\n\t\treturn fmt.Errorf("nenhum relogio informado para sincronizar")\n\t}\n'],

  ['func Heartbeat(cfg *config.Config) error {\n\tif cfg.DispositivoRep == nil {\n\t\treturn fmt.Errorf("secao dispositivo_rep ausente no config.yaml")\n\t}\n\td := cfg.DispositivoRep\n',
   'func Heartbeat(cfg *config.Config, d *config.DispositivoRepConfig) error {\n\tif d == nil {\n\t\treturn fmt.Errorf("nenhum relogio informado para o heartbeat")\n\t}\n'],

  ['func SincronizarCadastros(cfg *config.Config, limite int) (ResultadoCadastros, error) {\n\tvar resultado ResultadoCadastros\n\tif cfg.DispositivoRep == nil {\n\t\treturn resultado, fmt.Errorf("secao dispositivo_rep ausente no config.yaml — nada para sincronizar")\n\t}\n\td := cfg.DispositivoRep\n',
   'func SincronizarCadastros(cfg *config.Config, d *config.DispositivoRepConfig, limite int) (ResultadoCadastros, error) {\n\tvar resultado ResultadoCadastros\n\tif d == nil {\n\t\treturn resultado, fmt.Errorf("nenhum relogio informado para sincronizar cadastros")\n\t}\n'],

  ['func HigienizarListagem(cfg *config.Config) (ResultadoHigiene, error) {\n\tvar resultado ResultadoHigiene\n\tif cfg.DispositivoRep == nil {\n\t\treturn resultado, fmt.Errorf("secao dispositivo_rep ausente no config.yaml — nada para higienizar")\n\t}\n\td := cfg.DispositivoRep\n',
   'func HigienizarListagem(cfg *config.Config, d *config.DispositivoRepConfig) (ResultadoHigiene, error) {\n\tvar resultado ResultadoHigiene\n\tif d == nil {\n\t\treturn resultado, fmt.Errorf("nenhum relogio informado para higienizar")\n\t}\n'],

  ['func HigienizarRemocoes(cfg *config.Config, limite int) (ResultadoRemocao, error) {\n\tvar resultado ResultadoRemocao\n\tif cfg.DispositivoRep == nil {\n\t\treturn resultado, fmt.Errorf("secao dispositivo_rep ausente no config.yaml — nada para remover")\n\t}\n\td := cfg.DispositivoRep\n',
   'func HigienizarRemocoes(cfg *config.Config, d *config.DispositivoRepConfig, limite int) (ResultadoRemocao, error) {\n\tvar resultado ResultadoRemocao\n\tif d == nil {\n\t\treturn resultado, fmt.Errorf("nenhum relogio informado para remover")\n\t}\n'],
]
for (const [de, para] of assinaturas) troca(de, para, 1)

// 2. A fila deixa de ser plana: todo acesso passa a nomear o dispositivo dono do lote.
troca('pendentes, err := fila.Pendentes(cfg.Fila.Diretorio)',
      'pendentes, err := fila.Pendentes(cfg.Fila.Diretorio, d.ID)', 1)
troca('if err := fila.Remover(cfg.Fila.Diretorio, lote.LoteID); err != nil {',
      'if err := fila.Remover(cfg.Fila.Diretorio, d.ID, lote.LoteID); err != nil {', 1)
troca('erroFila := fila.Gravar(cfg.Fila.Diretorio, fila.Lote{',
      'erroFila := fila.Gravar(cfg.Fila.Diretorio, d.ID, fila.Lote{', 1)

fs.writeFileSync(alvo, src)

// 3. Invariantes: nenhuma leitura de cfg.DispositivoRep pode sobrar no ciclo — e' o que faria
//    uma funcao continuar mirando sempre o primeiro relogio.
const sobrou = (src.match(/cfg\.DispositivoRep/g) || []).length
if (sobrou !== 0) {
  console.error(`ABORTADO: ${sobrou} referencia(s) a cfg.DispositivoRep sobraram em ${alvo}`)
  process.exit(1)
}
const recebemDispositivo = (src.match(/d \*config\.DispositivoRepConfig/g) || []).length
if (recebemDispositivo !== 5) {
  console.error(`ABORTADO: ${recebemDispositivo} funcao(oes) recebendo o dispositivo, esperadas 5`)
  process.exit(1)
}
console.log('ciclo.go: 5 funcoes parametrizadas, 3 acessos de fila isolados por dispositivo')
