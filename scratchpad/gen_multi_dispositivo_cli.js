// Segunda parte do gerador da v0.9.0: a CLI passa a saber que existe mais de um relogio.
//
// Duas politicas, deliberadamente diferentes:
//   - comandos de ROTINA (sync/heartbeat/cadastros/higiene/higiene-remover) rodam em TODOS os
//     relogios por padrao, porque e' o que a bandeja ja faz sozinha e e' o que "a unidade
//     sincronizou" significa;
//   - comandos que falam com UM equipamento (afd-raw, afd-exportar, cadastros-exportar, e os dois
//     -testar, que GRAVAM usuario de teste) exigem --dispositivo quando ha mais de um. Exportar
//     "o AFD" de quatro relogios para um arquivo so' nao tem significado, e escrever um usuario de
//     teste em quatro equipamentos de producao por um comando que a pessoa achava que era um so'
//     e' exatamente o tipo de surpresa que nao pode existir aqui.
const fs = require('fs')

const alvo = 'tools/coletor-rep/cmd/cli/main.go'
let src = fs.readFileSync(alvo, 'utf8')

function troca(de, para, esperado) {
  const partes = src.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    console.error('ABORTADO: ' + esperado + ' esperada(s), ' + achou + ' encontrada(s) para:\n' + de + '\n')
    process.exit(1)
  }
  src = partes.join(para)
}

// 1. As cinco funcoes de equipamento unico recebem o relogio escolhido, em vez de pegarem o
//    (unico) do config. O bloco removido e' identico nas cinco.
const guardaAntiga = [
  '\tif cfg.DispositivoRep == nil {',
  '\t\tfmt.Fprintln(os.Stderr, "Secao dispositivo_rep ausente no config.yaml.")',
  '\t\tos.Exit(1)',
  '\t}',
  '\td := cfg.DispositivoRep',
  '',
].join('\n')
troca(guardaAntiga, '', 5)

troca('func rodarAfdRaw(cfg *config.Config) {',
      'func rodarAfdRaw(cfg *config.Config, d *config.DispositivoRepConfig) {', 1)
troca('func rodarAfdExportar(cfg *config.Config, caminhoCfg, caminhoSaida string) {',
      'func rodarAfdExportar(cfg *config.Config, d *config.DispositivoRepConfig, caminhoCfg, caminhoSaida string) {', 1)
troca('func rodarCadastrosExportar(cfg *config.Config, caminhoSaida string) {',
      'func rodarCadastrosExportar(cfg *config.Config, d *config.DispositivoRepConfig, caminhoSaida string) {', 1)
troca('func rodarCadastrosTestar(cfg *config.Config) {',
      'func rodarCadastrosTestar(cfg *config.Config, d *config.DispositivoRepConfig) {', 1)
troca('func rodarRemocaoTestar(cfg *config.Config) {',
      'func rodarRemocaoTestar(cfg *config.Config, d *config.DispositivoRepConfig) {', 1)

// 2. Dispatch: rotina em todos, equipamento unico exigindo escolha.
const dispatchAntigo = [
  '\tcomando := os.Args[1]',
  '\tswitch comando {',
  '\tcase "sync":',
  '\t\tif err := ciclo.Sync(cfg); err != nil {',
  '\t\t\tfmt.Fprintf(os.Stderr, "Falha na sincronizacao: %v\\n", err)',
  '\t\t\tos.Exit(1)',
  '\t\t}',
  '\tcase "heartbeat":',
  '\t\tif err := ciclo.Heartbeat(cfg); err != nil {',
  '\t\t\tfmt.Fprintf(os.Stderr, "Falha no heartbeat: %v\\n", err)',
  '\t\t\tos.Exit(1)',
  '\t\t}',
  '\tcase "diagnostico":',
  '\t\trodarDiagnostico(cfg)',
  '\tcase "afd-raw":',
  '\t\trodarAfdRaw(cfg)',
].join('\n')
const dispatchNovo = [
  '\tcomando := os.Args[1]',
  '\tswitch comando {',
  '\tcase "sync":',
  '\t\tif err := comTodos(cfg, ciclo.Sync, ciclo.SyncTodos); err != nil {',
  '\t\t\tfmt.Fprintf(os.Stderr, "Falha na sincronizacao: %v\\n", err)',
  '\t\t\tos.Exit(1)',
  '\t\t}',
  '\tcase "heartbeat":',
  '\t\tif err := comTodos(cfg, ciclo.Heartbeat, ciclo.HeartbeatTodos); err != nil {',
  '\t\t\tfmt.Fprintf(os.Stderr, "Falha no heartbeat: %v\\n", err)',
  '\t\t\tos.Exit(1)',
  '\t\t}',
  '\tcase "diagnostico":',
  '\t\trodarDiagnostico(cfg)',
  '\tcase "afd-raw":',
  '\t\trodarAfdRaw(cfg, escolherDispositivo(cfg))',
].join('\n')
troca(dispatchAntigo, dispatchNovo, 1)

troca('\t\trodarAfdExportar(cfg, caminhoCfg, os.Args[2])',
      '\t\trodarAfdExportar(cfg, escolherDispositivo(cfg), caminhoCfg, os.Args[2])', 1)
troca('\t\trodarCadastrosExportar(cfg, os.Args[2])',
      '\t\trodarCadastrosExportar(cfg, escolherDispositivo(cfg), os.Args[2])', 1)
troca('\t\trodarCadastrosTestar(cfg)', '\t\trodarCadastrosTestar(cfg, escolherDispositivo(cfg))', 1)
troca('\t\trodarRemocaoTestar(cfg)', '\t\trodarRemocaoTestar(cfg, escolherDispositivo(cfg))', 1)

troca('\t\tresultado, err := ciclo.SincronizarCadastros(cfg, 0)', [
  '\t\tresultado, err := comTodosResultado(cfg,',
  '\t\t\tfunc(d *config.DispositivoRepConfig) (ciclo.ResultadoCadastros, error) {',
  '\t\t\t\treturn ciclo.SincronizarCadastros(cfg, d, 0)',
  '\t\t\t},',
  '\t\t\tfunc() (ciclo.ResultadoCadastros, error) { return ciclo.SincronizarCadastrosTodos(cfg, 0) })',
].join('\n'), 1)

troca('\t\tresultado, err := ciclo.HigienizarListagem(cfg)', [
  '\t\tresultado, err := comTodosResultado(cfg,',
  '\t\t\tfunc(d *config.DispositivoRepConfig) (ciclo.ResultadoHigiene, error) {',
  '\t\t\t\treturn ciclo.HigienizarListagem(cfg, d)',
  '\t\t\t},',
  '\t\t\tfunc() (ciclo.ResultadoHigiene, error) { return ciclo.HigienizarListagemTodos(cfg) })',
].join('\n'), 1)

troca('\t\tif _, err := ciclo.HigienizarRemocoes(cfg, 0); err != nil {', [
  '\t\t_, err := comTodosResultado(cfg,',
  '\t\t\tfunc(d *config.DispositivoRepConfig) (ciclo.ResultadoRemocao, error) {',
  '\t\t\t\treturn ciclo.HigienizarRemocoes(cfg, d, 0)',
  '\t\t\t},',
  '\t\t\tfunc() (ciclo.ResultadoRemocao, error) { return ciclo.HigienizarRemocoesTodos(cfg, 0) })',
  '\t\tif err != nil {',
].join('\n'), 1)

// 3. Ajuda: a flag nova precisa aparecer, senao ninguem descobre que ela existe.
troca([
  'Flags:',
  '  --config <caminho>   caminho do config.yaml (default: config.yaml ao lado do executavel)',
].join('\n'), [
  'Flags:',
  '  --config <caminho>       caminho do config.yaml (default: config.yaml ao lado do executavel)',
  '  --dispositivo <ref>      qual relogio usar, por nome, ip ou id (maquinas com mais de um).',
  '                           Sem a flag, os comandos de rotina (sync/heartbeat/cadastros/higiene/',
  '                           higiene-remover) rodam em TODOS; os que falam com um equipamento so\'',
  '                           (afd-raw, afd-exportar, cadastros-exportar, cadastros-testar,',
  '                           remocao-testar) recusam ate\' voce escolher.',
].join('\n'), 1)

// 4. As funcoes de apoio novas.
troca('func caminhoConfig() string {', [
  '// referenciaDispositivo le a flag --dispositivo <ref> (ou --dispositivo=<ref>). Fica fora do',
  '// switch de comandos porque vale para todos, e os comandos ja usam os argumentos posicionais.',
  'func referenciaDispositivo() string {',
  '\tfor i, arg := range os.Args {',
  '\t\tif arg == "--dispositivo" && i+1 < len(os.Args) {',
  '\t\t\treturn os.Args[i+1]',
  '\t\t}',
  '\t\tif strings.HasPrefix(arg, "--dispositivo=") {',
  '\t\t\treturn strings.TrimPrefix(arg, "--dispositivo=")',
  '\t\t}',
  '\t}',
  '\treturn ""',
  '}',
  '',
  '// escolherDispositivo resolve O relogio dos comandos de equipamento unico. Com varios',
  '// configurados e nenhuma escolha, config.Dispositivo devolve erro listando os disponiveis - e',
  '// aqui isso encerra o comando, de proposito: adivinhar qual dos quatro seria escrever num',
  '// equipamento de producao por conta propria.',
  'func escolherDispositivo(cfg *config.Config) *config.DispositivoRepConfig {',
  '\td, err := cfg.Dispositivo(referenciaDispositivo())',
  '\tif err != nil {',
  '\t\tfmt.Fprintf(os.Stderr, "%v\\n", err)',
  '\t\tos.Exit(1)',
  '\t}',
  '\treturn d',
  '}',
  '',
  '// comTodos roda um comando de rotina: no relogio escolhido, se houve --dispositivo; em todos,',
  '// se nao houve.',
  'func comTodos(cfg *config.Config, um func(*config.Config, *config.DispositivoRepConfig) error, todos func(*config.Config) error) error {',
  '\tif ref := referenciaDispositivo(); ref != "" {',
  '\t\td, err := cfg.Dispositivo(ref)',
  '\t\tif err != nil {',
  '\t\t\treturn err',
  '\t\t}',
  '\t\treturn um(cfg, d)',
  '\t}',
  '\treturn todos(cfg)',
  '}',
  '',
  '// comTodosResultado e\' comTodos para os comandos que devolvem contadores somaveis.',
  'func comTodosResultado[T any](cfg *config.Config, um func(*config.DispositivoRepConfig) (T, error), todos func() (T, error)) (T, error) {',
  '\tif ref := referenciaDispositivo(); ref != "" {',
  '\t\td, err := cfg.Dispositivo(ref)',
  '\t\tif err != nil {',
  '\t\t\tvar zero T',
  '\t\t\treturn zero, err',
  '\t\t}',
  '\t\treturn um(d)',
  '\t}',
  '\treturn todos()',
  '}',
  '',
  'func caminhoConfig() string {',
].join('\n'), 1)

// 5. Diagnostico passa a percorrer todos os relogios.
troca([
  '\tif cfg.DispositivoRep == nil {',
  '\t\tfmt.Println("dispositivo_rep: nao configurado nesta maquina")',
  '\t} else {',
  '\t\td := cfg.DispositivoRep',
  '\t\tfmt.Printf("dispositivo_rep: %s (%s:%d)\\n", d.ID, d.Endereco, d.Porta)',
  '',
].join('\n'), [
  '\tdispositivos := cfg.Dispositivos()',
  '\tif len(dispositivos) == 0 {',
  '\t\tfmt.Println("dispositivo_rep: nao configurado nesta maquina")',
  '\t}',
  '\tfor _, d := range dispositivos {',
  '\t\tfmt.Printf("relogio %s: %s (%s:%d)\\n", d.Rotulo(), d.ID, d.Endereco, d.Porta)',
  '',
].join('\n'), 1)

fs.writeFileSync(alvo, src)

const sobrou = (src.match(/cfg\.DispositivoRep\b/g) || []).length
if (sobrou !== 0) {
  console.error('ABORTADO: ' + sobrou + ' referencia(s) a cfg.DispositivoRep sobraram em ' + alvo)
  process.exit(1)
}
console.log('cli/main.go: dispatch multi-relogio aplicado')
