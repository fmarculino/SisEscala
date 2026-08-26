// Acrescenta o item "Copiar biometria entre os relogios" ao menu da bandeja.
//
// ⚠️ Item de MENU, nunca no ticker automatico: gravar template pela API ainda nao foi confirmado
// contra hardware (rep.formatosTemplate). A trava e' deliberada e sai quando alguem rodar
// `coletor-rep-cli biometria-testar` numa unidade e confirmar o formato.
const fs = require('fs')

const alvo = 'tools/coletor-rep/cmd/tray/main.go'
const original = fs.readFileSync(alvo, 'utf8')
if (!original.includes('\r\n')) {
  console.error('ABORTADO: ' + alvo + ' deixou de ser CRLF')
  process.exit(1)
}
let src = original.split('\r\n').join('\n')

function troca(de, para, esperado) {
  const partes = src.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    console.error('ABORTADO: ' + esperado + ' esperada(s), ' + achou + ' encontrada(s) para:\n' + de)
    process.exit(1)
  }
  src = partes.join(para)
}

// 1. O item, logo depois do de remocoes de higiene.
troca([
  '\titemHigienizarRemocoes := systray.AddMenuItem("Executar remocoes de higiene agora", "Aplica no relogio as remocoes marcadas na tela de Higiene do SisEscala")',
  '\tif len(dispositivos) == 0 {',
  '\t\titemHigienizarRemocoes.Disable()',
  '\t}',
].join('\n'), [
  '\titemHigienizarRemocoes := systray.AddMenuItem("Executar remocoes de higiene agora", "Aplica no relogio as remocoes marcadas na tela de Higiene do SisEscala")',
  '\tif len(dispositivos) == 0 {',
  '\t\titemHigienizarRemocoes.Disable()',
  '\t}',
  '\t// Copia de digital entre os relogios DESTA maquina (mesma unidade). Fica no menu, e nao no',
  '\t// ciclo automatico, porque gravar template pela API ainda nao foi confirmado contra hardware',
  '\t// real - ver rep.formatosTemplate e `coletor-rep-cli biometria-testar`. Sem pelo menos dois',
  '\t// relogios aqui nao ha o que copiar.',
  '\titemSincronizarBiometria := systray.AddMenuItem("Copiar biometria entre os relogios",',
  '\t\t"Copia para cada relogio as digitais que faltam nele e ja existem em outro relogio desta unidade")',
  '\tif len(dispositivos) < 2 {',
  '\t\titemSincronizarBiometria.Disable()',
  '\t}',
].join('\n'), 1)

// 2. O clique, junto dos outros.
troca([
  '\t\t\tcase <-itemVerLogs.ClickedCh:',
].join('\n'), [
  '\t\t\tcase <-itemSincronizarBiometria.ClickedCh:',
  '\t\t\t\titemSincronizarBiometria.SetTitle("Copiando biometria...")',
  '\t\t\t\titemSincronizarBiometria.Disable()',
  '\t\t\t\t_ = beeep.Notify("SisEscala - Coletor", "Copiando digitais entre os relogios desta unidade...", nil)',
  '\t\t\t\tresultado, err := ciclo.SincronizarBiometriaTodos(cfg, 0)',
  '\t\t\t\tif err != nil {',
  '\t\t\t\t\tlog.Printf("erro ao copiar biometria: %v", err)',
  '\t\t\t\t\t_ = beeep.Notify("SisEscala - Coletor", "Falha ao copiar biometria entre os relogios. Ver log.", nil)',
  '\t\t\t\t} else if resultado.Pendentes == 0 {',
  '\t\t\t\t\t_ = beeep.Notify("SisEscala - Coletor", "Nenhuma digital pendente entre os relogios desta unidade.", nil)',
  '\t\t\t\t} else {',
  '\t\t\t\t\t_ = beeep.Notify("SisEscala - Coletor",',
  '\t\t\t\t\t\tfmt.Sprintf("%d digital(is) copiada(s), %d falha(s).", resultado.Copiados, resultado.Falhas), nil)',
  '\t\t\t\t}',
  '\t\t\t\titemSincronizarBiometria.SetTitle("Copiar biometria entre os relogios")',
  '\t\t\t\titemSincronizarBiometria.Enable()',
  '\t\t\tcase <-itemVerLogs.ClickedCh:',
].join('\n'), 1)

fs.writeFileSync(alvo, src.split('\n').join('\r\n'))
console.log('cmd/tray/main.go: item de biometria acrescentado (CRLF preservado)')
