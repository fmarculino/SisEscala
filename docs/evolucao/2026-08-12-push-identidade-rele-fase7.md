# Push de identidade para o relógio (Fase 7, parte identidade) — 12/08/2026

## Contexto

Perguntando sobre a tela de dispositivos REP, o usuário notou que `dispositivos_rep.unidade_id`
não controla quem pode bater ponto no relógio físico (é só um rótulo administrativo dentro do
SisEscala), e que o vínculo real entre o identificador do relógio (CPF) e um servidor
(`rep_vinculos_servidor`) não tinha tela nenhuma — só existia via `fn_vinculos_sugeridos_afd` e
SQL direto. Com instalação em mais unidades prevista, isso deixa de ser sustentável: cada relógio
novo geraria marcação que ninguém consegue atribuir até alguém rodar SQL na mão.

O plano original (Fase 7) já previa isso, deliberadamente adiado ("hoje isso é feito
manualmente e funciona"). Perguntado se biometria também podia ser empurrada por API, a resposta
do plano era clara: não, o template do dedo exige a pessoa presente no sensor — só a identidade
(matrícula/nome/CPF) pode ser preparada com antecedência. O usuário escolheu o escopo completo:
push de identidade + tela de pendências de biometria, em vez de só a tela de vínculo.

## O que foi construído

**Banco** (`20260812000000_add_rep_cadastros_push.sql`):
- `rep_cadastros_fila` — fila efêmera, um job pendente por par (dispositivo, servidor).
- `fn_enfileirar_cadastros_rep` — admin clica, enfileira quem está ativo na unidade/setor do
  dispositivo, tem CPF preenchido e ainda não tem vínculo vigente. Devolve contagem de
  enfileirados/sem-CPF/já-vinculados para a tela mostrar.
- `fn_cadastros_pendentes_dispositivo` / `fn_confirmar_cadastro_rep` — o par que o coletor usa
  para puxar a fila e confirmar resultado. Sucesso cria/renova `rep_vinculos_servidor` com
  `tem_biometria = false`, fechando qualquer vínculo vigente anterior do mesmo par (mesma
  disciplina de vigência que já protege o sentido AFD→servidor).
- `fn_atualizar_biometria_vinculos` — só liga `tem_biometria`, nunca desliga sozinha. Uma leitura
  parcial do relógio não pode fazer alguém que já tem o dedo cadastrado voltar a "pendente".
- `fn_pendencias_biometria` — quem já tem identidade no relógio mas ainda não tem biometria,
  com o mesmo filtro de escopo (`fn_unidade_no_escopo`) das outras telas de gestão.

**Rotas** (`/api/rep/v1/pendencias` deixou de ser um stub que sempre devolvia `[]`; nova
`/api/rep/v1/biometria`), autenticação idêntica às demais rotas do coletor (Bearer + HMAC
anti-replay sobre o token do dispositivo).

**Telas**: botão "Sincronizar cadastros" no modal de Dispositivo REP; nova aba "Biometria
Pendente" em `/marcacoes`, agrupada por relógio.

**Coletor Go**: `rep.CriarUsuario`/`rep.ListarUsuariosComBiometria` (API genérica "objects" da
Control iD — `create_objects.fcgi`/`load_objects.fcgi`); `ciclo.SincronizarCadastros` liga tudo;
novo subcomando `coletor-rep cadastros` (aplica a fila real) e `coletor-rep cadastros-testar`
(diagnóstico — cria um usuário de teste isolado, sem tocar na fila do SisEscala); item de menu
"Sincronizar cadastros agora" na bandeja.

## Por que isso NÃO entrou no ciclo automático

`login.fcgi` e `get_afd.fcgi` só viraram confiáveis depois de bater com `curl.exe -sk` contra o
relógio real (10.110.2.89) — e mesmo assim o formato de data do AFD (armadilha 11) pareceu
razoável e estava errado, descoberto só ao ler os bytes crus do equipamento. `create_objects.fcgi`
nunca foi testado contra nenhum hardware. Os nomes de campo usados (`registration`, `pis`) não são
chute — já apareceram confirmados em leitura de AFD tipo 5 real — mas **escrever** neles, e o
formato da resposta (`{"ids":[...]}` assumido), é a parte não confirmada.

Por isso o push de identidade só roda por clique manual (menu da bandeja) ou pelo subcomando
`cadastros` da CLI — nunca no ticker de 5 minutos que já roda `Sync`/`Heartbeat` sozinho. Um clique
errado é recuperável (apagar o usuário de teste pela interface do próprio relógio); um loop
automático escrevendo com o campo errado, repetidas vezes, num relógio de produção não seria.
`coletor-rep cadastros-testar` existe para ser o "afd-raw" desta função: cria **um** usuário
marcado como teste, imprime a resposta crua em caso de erro, e não risca a fila real do SisEscala.

**Antes de instalar isso numa unidade nova**: rodar `coletor-rep cadastros-testar` contra o
relógio dessa unidade primeiro, e só depois usar o botão da bandeja ou "Sincronizar cadastros"
pela tela.

## Resultado dos testes reais (fecha em 12/08/2026)

`coletor-rep-cli cadastros-testar` rodado cinco vezes contra o relógio de teste (10.110.2.89),
cada rodada corrigindo o que a anterior revelou:

1. API genérica "objects" (`create_objects.fcgi`/`load_objects.fcgi`) — HTTP 400 "Invalid
   command". Era a API da Linha de Acesso da Control iD (iDAccess/iDFlex/iDBlock), não a linha
   REP/iDClass deste equipamento.
2. `add_users.fcgi`/`load_users.fcgi` (pesquisados na documentação oficial da Control iD) —
   comando certo, mas CPF de teste `"000000000000"` reprovado no dígito verificador e
   `limit: 1000` acima do máximo documentado (100).
3. Corrigidos CPF de teste e paginação — `load_users.fcgi` devolveu **6 usuários reais do
   piloto com sucesso**, revelando que o objeto "user" deste device **não tem campo `"id"`** — só
   `pis`/`registration`/`code`/`rfid`/`templates`, todos como **número JSON**, não string.
4. `registration`/`cpf` passam a ser enviados como número; `device_user_id` (que não existe de
   verdade neste hardware) foi substituído por `identificador_afd` como identidade de
   referência em toda a cadeia.
5. Matrícula temporária (`T26xxxxx`) — o usuário confirmou que a convenção já em uso manual
   neste mesmo relógio, para os servidores temporários já cadastrados nele, é remover o `T` e
   tratar o resto como número. Não estava documentada em lugar nenhum do repositório; replicada
   em `CriarUsuario` em vez de inventada.

**Sexto teste: sucesso completo.** `CriarUsuario` criou um usuário de teste real no relógio
("SISESCALA TESTE - PODE APAGAR", matrícula 900000); `ListarUsuariosComBiometria` achou os 5
servidores reais do piloto com biometria já cadastrada, CPFs batendo com o cadastro do SisEscala.
Push de identidade está confirmado contra hardware real — continua fora do ciclo automático da
bandeja por prudência (escrita em equipamento de produção), não por dúvida sobre o formato.

## Continuação do trabalho desta sessão

Antes disso, a mesma sessão corrigiu dois bugs achados testando em campo, pela primeira vez, o
app de bandeja construído na sessão anterior:

1. **Cookie do terminal local** (`path: '/presenca-local'` não cobria `/api/presenca-local/*`) —
   toda batida caía em "Terminal não ativado" mesmo com a ativação funcionando. v1.49.0.
2. **Auto-instalação nunca rodava em máquina real** — o atalho de "modo dev" detectava
   `go run` pela presença de `config.yaml` na pasta atual, e o Explorer do Windows sempre abre um
   `.exe` com essa pasta sendo a do próprio executável (onde o `.zip` baixado deixa o
   `config.yaml`). Todo duplo-clique caía no atalho, nunca instalava de verdade. v1.49.1.

Ver `docs/evolucao/2026-08-11-cookie-terminal-local-credenciais-rep-e-exclusao.md` para o
primeiro conjunto de correções desta mesma rodada de testes (cookie, credenciais do relógio na
UI, exclusão de terminais/dispositivos).
