// Terceira parte do gerador da v0.9.0: o app de bandeja passa a atender todos os relogios da
// maquina num ciclo so'.
//
// ⚠️ cmd/tray/main.go e' CRLF (o resto do coletor e' LF). O gerador normaliza na leitura e
// devolve CRLF na escrita — sem isso, o arquivo inteiro apareceria como reescrito no diff e
// esconderia a mudanca de verdade.
const fs = require('fs')

const alvo = 'tools/coletor-rep/cmd/tray/main.go'
const original = fs.readFileSync(alvo, 'utf8')
if (!original.includes('\r\n')) {
  console.error('ABORTADO: ' + alvo + ' deixou de ser CRLF — confira antes de regravar')
  process.exit(1)
}
let src = original.split('\r\n').join('\n')

function troca(de, para, esperado) {
  const partes = src.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    console.error('ABORTADO: ' + esperado + ' esperada(s), ' + achou + ' encontrada(s) para:\n' + de + '\n')
    process.exit(1)
  }
  src = partes.join(para)
}

// 1. O menu lista TODOS os relogios, um item por equipamento.
troca([
  '\tif cfg.DispositivoRep != nil && cfg.DispositivoRep.Endereco != "" {',
  '\t\trelogioTexto := "Relógio IP: " + cfg.DispositivoRep.Endereco',
  '\t\tif cfg.DispositivoRep.Porta != 0 && cfg.DispositivoRep.Porta != 80 && cfg.DispositivoRep.Porta != 443 {',
  '\t\t\trelogioTexto += fmt.Sprintf(":%d", cfg.DispositivoRep.Porta)',
  '\t\t}',
  '\t\titemRelogio := systray.AddMenuItem(relogioTexto, "Endereço IP do relógio de ponto (REP)")',
  '\t\titemRelogio.Disable()',
  '\t} else if cfg.DispositivoRep == nil {',
  '\t\titemRelogio := systray.AddMenuItem("Relógio IP: não configurado", "Esta máquina não coleta de um relógio de ponto físico")',
  '\t\titemRelogio.Disable()',
  '\t}',
].join('\n'), [
  '\t// Uma linha por relogio: uma unidade pode ter varios equipamentos atendidos por esta mesma',
  '\t// maquina (medido: 4), e "Relógio IP: x" no singular deixava de responder "quais?".',
  '\tdispositivos := cfg.Dispositivos()',
  '\tif len(dispositivos) == 0 {',
  '\t\titemRelogio := systray.AddMenuItem("Relógio IP: não configurado", "Esta máquina não coleta de um relógio de ponto físico")',
  '\t\titemRelogio.Disable()',
  '\t}',
  '\tfor _, d := range dispositivos {',
  '\t\tif d.Endereco == "" {',
  '\t\t\tcontinue',
  '\t\t}',
  '\t\titemRelogio := systray.AddMenuItem(rotuloMenuRelogio(d), "Relógio de ponto (REP) coletado por esta máquina")',
  '\t\titemRelogio.Disable()',
  '\t}',
].join('\n'), 1)

// 2. Os tres itens de menu que dependem de haver relogio.
troca([
  '\tif cfg.DispositivoRep == nil {',
  '\t\titemSincronizarCadastros.Disable()',
  '\t}',
].join('\n'), [
  '\tif len(dispositivos) == 0 {',
  '\t\titemSincronizarCadastros.Disable()',
  '\t}',
].join('\n'), 1)
troca([
  '\tif cfg.DispositivoRep == nil {',
  '\t\titemHigienizarCadastros.Disable()',
  '\t}',
].join('\n'), [
  '\tif len(dispositivos) == 0 {',
  '\t\titemHigienizarCadastros.Disable()',
  '\t}',
].join('\n'), 1)
troca([
  '\tif cfg.DispositivoRep == nil {',
  '\t\titemHigienizarRemocoes.Disable()',
  '\t}',
].join('\n'), [
  '\tif len(dispositivos) == 0 {',
  '\t\titemHigienizarRemocoes.Disable()',
  '\t}',
].join('\n'), 1)

// 3. O ciclo automatico roda em todos os relogios.
troca('\t\tif cfg.DispositivoRep != nil {', '\t\tif len(dispositivos) > 0 {', 1)
troca('\t\t\tif err := ciclo.Sync(cfg); err != nil {', '\t\t\tif err := ciclo.SyncTodos(cfg); err != nil {', 1)
troca('\t\t\tif err := ciclo.Heartbeat(cfg); err != nil {', '\t\t\tif err := ciclo.HeartbeatTodos(cfg); err != nil {', 1)
troca('\t\t\tif resultado, err := ciclo.SincronizarCadastros(cfg, ciclo.LimiteCadastrosPorCiclo); err != nil {',
      '\t\t\tif resultado, err := ciclo.SincronizarCadastrosTodos(cfg, ciclo.LimiteCadastrosPorCiclo); err != nil {', 1)
troca('\t\t\tif resRemocao, err := ciclo.HigienizarRemocoes(cfg, ciclo.LimiteRemocoesPorCiclo); err != nil {',
      '\t\t\tif resRemocao, err := ciclo.HigienizarRemocoesTodos(cfg, ciclo.LimiteRemocoesPorCiclo); err != nil {', 1)

// 4. Os cliques manuais do menu, idem.
troca('\t\t\t\tresultado, err := ciclo.SincronizarCadastros(cfg, 0)',
      '\t\t\t\tresultado, err := ciclo.SincronizarCadastrosTodos(cfg, 0)', 1)
troca('\t\t\t\tresultado, err := ciclo.HigienizarListagem(cfg)',
      '\t\t\t\tresultado, err := ciclo.HigienizarListagemTodos(cfg)', 1)
troca('\t\t\t\tresultado, err := ciclo.HigienizarRemocoes(cfg, 0)',
      '\t\t\t\tresultado, err := ciclo.HigienizarRemocoesTodos(cfg, 0)', 1)

// 5. O rotulo de cada relogio no menu.
troca('func aoIniciar(cfg *config.Config, dirInstalado string) {', [
  '// rotuloMenuRelogio e\' a linha (nao clicavel) que identifica um relogio no menu. O nome vem do',
  '// config.yaml preenchido pelo SisEscala no "Baixar aplicativo"; sem nome, o IP identifica.',
  'func rotuloMenuRelogio(d *config.DispositivoRepConfig) string {',
  '\tendereco := d.Endereco',
  '\tif d.Porta != 0 && d.Porta != 80 && d.Porta != 443 {',
  '\t\tendereco += fmt.Sprintf(":%d", d.Porta)',
  '\t}',
  '\tif d.Nome != "" {',
  '\t\treturn "Relógio: " + d.Nome + " (" + endereco + ")"',
  '\t}',
  '\treturn "Relógio IP: " + endereco',
  '}',
  '',
  'func aoIniciar(cfg *config.Config, dirInstalado string) {',
].join('\n'), 1)

fs.writeFileSync(alvo, src.split('\n').join('\r\n'))

const sobrou = (src.match(/cfg\.DispositivoRep\b/g) || []).length
if (sobrou !== 0) {
  console.error('ABORTADO: ' + sobrou + ' referencia(s) a cfg.DispositivoRep sobraram em ' + alvo)
  process.exit(1)
}
console.log('cmd/tray/main.go: bandeja multi-relogio aplicada (CRLF preservado)')
