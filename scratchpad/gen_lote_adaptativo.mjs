// Coletor v0.18.0: lote de AFD adaptativo. ABORTA se qualquer trecho nao bater exatamente 1 vez.
import fs from 'fs'
const ARQ = 'tools/coletor-rep/ciclo/ciclo.go'
let s = fs.readFileSync(ARQ, 'utf8')
const N = s.includes('\r\n') ? '\r\n' : '\n'
console.log('fonte: ' + ARQ + ' (' + (N === '\r\n' ? 'CRLF' : 'LF') + ')')
const sub = (de, para) => {
  const d = de.replace(/\n/g, N), p = para.replace(/\n/g, N)
  const n = s.split(d).length - 1
  if (n !== 1) throw new Error('esperava 1 ocorrencia, achei ' + n + ': ' + d.slice(0, 80))
  s = s.replace(d, p)
}

sub('const Versao = "0.17.0"', 'const Versao = "0.18.0"')

const HELPER = [
  '// Tamanho do lote de AFD. Era 500 fixo ate a v0.18.0, e 500 e grande demais: `fn_ingerir_afd`',
  '// RECONCILIA dentro da propria transacao (um fn_reconciliar_pessoa_dia por par servidor/dia), e',
  '// um lote de 500 batidas de hospital gera ~390 pares.',
  '//',
  '// 🚨 Medido em producao em 19/09/2026: ~3s por 50 linhas, ou seja ~30s de ingestao num lote de',
  '// 500 — mais o que a rota gastava refazendo a MESMA reconciliacao por HTTP. Passando dos 60s de',
  '// timeout deste cliente, a conexao cai e o Postgres REVERTE a transacao INTEIRA, inclusive a',
  '// linha de rep_sincronizacoes: falha que nao deixa rastro em lugar nenhum. E como o cursor',
  '// continua apontando para o inicio do trecho, o ciclo seguinte remonta EXATAMENTE o mesmo lote',
  '// de 500 e bate no mesmo timeout — para sempre. Foi assim que o REP-iDClass-HMI-01 ficou 38h',
  '// com 509 batidas so na memoria do equipamento, enquanto a tela dizia "ultimo contato: ha 2 min".',
  'const (',
  '\ttamanhoLotePadrao = 150',
  '\t// Abaixo disto nao vale dividir: se 25 linhas nao entram, o problema nao e tamanho.',
  '\ttamanhoLoteMinimo = 25',
  ')',
  '',
  '// enviarComFatiamento envia um trecho de AFD e, se o envio falhar por TRANSPORTE (timeout, queda',
  '// de conexao), divide o trecho ao meio e tenta cada metade — recursivamente, ate tamanhoLoteMinimo.',
  '//',
  '// ⚠️ So refatia em falha de TRANSPORTE. Erro que o servidor RESPONDEU (401 de token, 403 de dono',
  '// da fila, 400 de payload) nao muda de resultado por ser menor: refatiar ali so multiplicaria as',
  '// tentativas de uma falha sistematica e prenderia o ciclo, que divide uma goroutine com o menu',
  '// da bandeja. E a mesma distincao que ehFalhaDeTransporte ja faz para a fila de cadastros.',
  '//',
  '// Devolve os trechos que falharam mesmo assim, na ordem, para o chamador gravar na fila.',
  'func enviarComFatiamento(sc *sisescala.Client, dispositivoID string, trecho []string, arquivoSHA256 string) [][]string {',
  '\tif len(trecho) == 0 {',
  '\t\treturn nil',
  '\t}',
  '\tloteID := loteIDDeterministico(dispositivoID, trecho)',
  '\tresultado, err := sc.EnviarLote(loteID, trecho, arquivoSHA256, Versao, Hostname())',
  '\tif err == nil {',
  '\t\tlog.Printf("lote %s (%d linhas): novas=%d duplicadas=%d marcacoes=%d orfas=%d nsr_max_aceito=%d",',
  '\t\t\tloteID, len(trecho), resultado.Novas, resultado.Duplicadas, resultado.Marcacoes,',
  '\t\t\tresultado.Orfas, resultado.NsrMaxAceito)',
  '\t\treturn nil',
  '\t}',
  '\tif !ehFalhaDeTransporte(err) || len(trecho) <= tamanhoLoteMinimo {',
  '\t\tlog.Printf("lote %s (%d linhas) falhou: %v", loteID, len(trecho), err)',
  '\t\treturn [][]string{trecho}',
  '\t}',
  '\tmeio := len(trecho) / 2',
  '\tlog.Printf("lote %s (%d linhas) falhou por transporte (%v); dividindo em %d + %d e tentando de novo",',
  '\t\tloteID, len(trecho), err, meio, len(trecho)-meio)',
  '\tvar falhados [][]string',
  '\tfalhados = append(falhados, enviarComFatiamento(sc, dispositivoID, trecho[:meio], arquivoSHA256)...)',
  '\tfalhados = append(falhados, enviarComFatiamento(sc, dispositivoID, trecho[meio:], arquivoSHA256)...)',
  '\treturn falhados',
  '}',
  '',
  '// loteIDDeterministico gera um identificador em formato UUID',
].join('\n')

sub('// loteIDDeterministico gera um identificador em formato UUID', HELPER)

const FILA_DE = [
  '\tfor i, lote := range pendentes {',
  '\t\tresultado, err := sc.EnviarLote(lote.LoteID, lote.Linhas, lote.ArquivoSHA256, Versao, Hostname())',
  '\t\tif err != nil {',
  '\t\t\tlog.Printf("lote %s continua na fila: %v", lote.LoteID, err)',
  '\t\t\tfalhasSeguidas++',
  '\t\t\tif falhasSeguidas >= falhasSeguidasParaDesistir {',
  '\t\t\t\tlog.Printf("desistindo do reenvio da fila neste ciclo apos %d falhas seguidas: "+',
  '\t\t\t\t\t"%d lote(s) continuam na fila para o proximo ciclo", falhasSeguidas, len(pendentes)-i-1)',
  '\t\t\t\tbreak',
  '\t\t\t}',
  '\t\t\tcontinue',
  '\t\t}',
  '\t\tfalhasSeguidas = 0',
  '\t\tlog.Printf("lote %s da fila reenviado: novas=%d duplicadas=%d marcacoes=%d orfas=%d",',
  '\t\t\tlote.LoteID, resultado.Novas, resultado.Duplicadas, resultado.Marcacoes, resultado.Orfas)',
  '\t\tif err := fila.Remover(cfg.Fila.Diretorio, d.ID, lote.LoteID); err != nil {',
  '\t\t\tlog.Printf("aviso: nao foi possivel remover lote %s da fila apos ACK: %v", lote.LoteID, err)',
  '\t\t}',
  '\t}',
].join('\n')

const FILA_PARA = [
  '\tfor i, lote := range pendentes {',
  '\t\t// Passa pelo fatiamento adaptativo tambem no REENVIO: a fila de campo tem lotes de 500',
  '\t\t// gravados por versoes anteriores, e sem dividir eles nunca sairiam de la.',
  '\t\tfalhados := enviarComFatiamento(sc, d.ID, lote.Linhas, lote.ArquivoSHA256)',
  '\t\tif len(falhados) > 0 {',
  '\t\t\tlog.Printf("lote %s continua na fila (%d trecho(s) nao entraram)", lote.LoteID, len(falhados))',
  '\t\t\tfalhasSeguidas++',
  '\t\t\tif falhasSeguidas >= falhasSeguidasParaDesistir {',
  '\t\t\t\tlog.Printf("desistindo do reenvio da fila neste ciclo apos %d falhas seguidas: "+',
  '\t\t\t\t\t"%d lote(s) continuam na fila para o proximo ciclo", falhasSeguidas, len(pendentes)-i-1)',
  '\t\t\t\tbreak',
  '\t\t\t}',
  '\t\t\tcontinue',
  '\t\t}',
  '\t\tfalhasSeguidas = 0',
  '\t\t// O lote saiu inteiro — possivelmente fatiado em varios lote_id novos, que e inofensivo:',
  '\t\t// fn_ingerir_afd e idempotente por (dispositivo_id, geracao, nsr), entao o mesmo NSR',
  '\t\t// chegando sob outro lote_id entra como DUPLICADO, nunca como batida nova.',
  '\t\tif err := fila.Remover(cfg.Fila.Diretorio, d.ID, lote.LoteID); err != nil {',
  '\t\t\tlog.Printf("aviso: nao foi possivel remover lote %s da fila apos ACK: %v", lote.LoteID, err)',
  '\t\t}',
  '\t}',
].join('\n')

sub(FILA_DE, FILA_PARA)

const ENVIO_DE = [
  '\tarquivoSHA256 := rep.SHA256Hex(bruto)',
  '\tconst tamanhoLote = 500',
  '\tfor inicio := 0; inicio < len(linhas); inicio += tamanhoLote {',
  '\t\tfim := inicio + tamanhoLote',
  '\t\tif fim > len(linhas) {',
  '\t\t\tfim = len(linhas)',
  '\t\t}',
  '\t\ttrecho := linhas[inicio:fim]',
  '\t\tloteID := loteIDDeterministico(d.ID, trecho)',
  '',
  '\t\tresultado, err := sc.EnviarLote(loteID, trecho, arquivoSHA256, Versao, Hostname())',
  '\t\tif err != nil {',
  '\t\t\tlog.Printf("falha ao enviar lote %s, gravando na fila offline: %v", loteID, err)',
  '\t\t\terroFila := fila.Gravar(cfg.Fila.Diretorio, d.ID, fila.Lote{',
  '\t\t\t\tLoteID: loteID, Linhas: trecho, ArquivoSHA256: arquivoSHA256,',
  '\t\t\t\tColetorVersao: Versao, ColetorHost: Hostname(),',
  '\t\t\t})',
  '\t\t\tif erroFila != nil {',
  '\t\t\t\tlog.Printf("erro: falha tambem ao gravar na fila: %v", erroFila)',
  '\t\t\t}',
  '\t\t\tcontinue',
  '\t\t}',
  '\t\tlog.Printf("lote %s: novas=%d duplicadas=%d marcacoes=%d orfas=%d nsr_max_aceito=%d",',
  '\t\t\tloteID, resultado.Novas, resultado.Duplicadas, resultado.Marcacoes, resultado.Orfas, resultado.NsrMaxAceito)',
  '\t}',
  '\treturn nil',
  '}',
].join('\n')

const ENVIO_PARA = [
  '\tarquivoSHA256 := rep.SHA256Hex(bruto)',
  '\tfor inicio := 0; inicio < len(linhas); inicio += tamanhoLotePadrao {',
  '\t\tfim := inicio + tamanhoLotePadrao',
  '\t\tif fim > len(linhas) {',
  '\t\t\tfim = len(linhas)',
  '\t\t}',
  '\t\tfalhados := enviarComFatiamento(sc, d.ID, linhas[inicio:fim], arquivoSHA256)',
  '\t\tif len(falhados) == 0 {',
  '\t\t\tcontinue',
  '\t\t}',
  '\t\tfor _, t := range falhados {',
  '\t\t\tloteID := loteIDDeterministico(d.ID, t)',
  '\t\t\tlog.Printf("gravando lote %s (%d linhas) na fila offline", loteID, len(t))',
  '\t\t\tif erroFila := fila.Gravar(cfg.Fila.Diretorio, d.ID, fila.Lote{',
  '\t\t\t\tLoteID: loteID, Linhas: t, ArquivoSHA256: arquivoSHA256,',
  '\t\t\t\tColetorVersao: Versao, ColetorHost: Hostname(),',
  '\t\t\t}); erroFila != nil {',
  '\t\t\t\tlog.Printf("erro: falha tambem ao gravar na fila: %v", erroFila)',
  '\t\t\t}',
  '\t\t}',
  '\t\t// PARA no primeiro trecho que nao entrou, em vez de seguir para o proximo. Os lotes sao',
  '\t\t// CONTIGUOS em NSR: mandar o posterior enquanto o anterior falha e exatamente o que cria a',
  '\t\t// lacuna, e o cursor (fim do trecho contiguo + 1) fica preso atras dela de qualquer forma —',
  '\t\t// nao ha nada a ganhar avancando. O resto vem no proximo ciclo.',
  '\t\tlog.Printf("interrompendo o envio deste AFD: o trecho a partir da linha %d nao entrou, "+',
  '\t\t\t"e mandar os seguintes so criaria lacuna de NSR", inicio+1)',
  '\t\tbreak',
  '\t}',
  '\treturn nil',
  '}',
].join('\n')

sub(ENVIO_DE, ENVIO_PARA)

fs.writeFileSync(ARQ, s)
console.log('  4 substituicoes aplicadas')

const conf = fs.readFileSync(ARQ, 'utf8')
const exigir = (re, n, rot) => {
  const c = (conf.match(re) || []).length
  if (c !== n) throw new Error('invariante "' + rot + '": esperava ' + n + ', achei ' + c)
  console.log('  invariante OK: ' + rot + ' (' + c + ')')
}
exigir(/tamanhoLote\b/g, 0, 'constante antiga tamanhoLote=500 removida')
exigir(/enviarComFatiamento\(/g, 5, 'enviarComFatiamento: 1 def + 4 usos')
// 2 = o uso novo de enviarComFatiamento + o que a fila de CADASTROS ja fazia desde a v0.17.0.
exigir(/ehFalhaDeTransporte\(err\)/g, 2, 'so refatia em falha de transporte')
exigir(/const Versao = "0\.18\.0"/g, 1, 'versao bumpada')
// 3 = declaracao + o teste que para a recursao + a mencao no comentario do helper.
exigir(/tamanhoLoteMinimo/g, 3, 'piso de fatiamento presente')
