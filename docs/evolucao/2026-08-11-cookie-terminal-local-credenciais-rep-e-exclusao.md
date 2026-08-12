# Cookie do terminal local, credenciais do relógio na UI e exclusão — 11/08/2026

Continuação da sessão que fechou a Fase 4 em código e construiu o app de bandeja. Três problemas
apareceram ao testar em campo pela primeira vez (máquina real, relógio real, terminal local ativado
pelo app), mais um pedido de gestão que faltava na tela.

## 1. Terminal ativava mas toda batida caía em "TERMINAL NÃO ATIVADO"

`/api/presenca-local/ativar` gravava o cookie de sessão com `path: '/presenca-local'`. Path de
cookie é prefixo de rota, não escopo por "aplicação": `/api/presenca-local/registrar` é um prefixo
**irmão** de `/presenca-local`, não um filho dele — os dois só têm `/` em comum. O navegador nunca
enviava o cookie na chamada de registro, então `validarSessaoTerminalLocal` sempre recebia
`undefined` e a rota respondia 401, que o frontend traduz para a tela "Terminal não ativado".

A ativação em si funcionava (por isso a tela de ativação mostrava sucesso e trocava para
`/presenca-local`), e a leitura do cookie pela própria página `/presenca-local` também funcionava
(está sob o mesmo prefixo `/presenca-local`) — só a chamada para a API de registro, que vive sob
`/api/presenca-local/*`, ficava sem o cookie. Sintoma só aparecia no passo de bater o ponto, não no
de abrir a tela — o que combinava exatamente com essa causa.

Corrigido trocando para `path: '/'` em `src/app/api/presenca-local/ativar/route.ts`. Cookie
continua `httpOnly` + `sameSite: lax` + assinado por HMAC; nenhuma outra rota lê esse cookie, então
ampliar o path não expõe nada nem muda a superfície de autenticação.

## 2. Senha do relógio ainda exigia edição manual do config.yaml

A v1.48.2 (sessão anterior) eliminou a edição manual de `config.yaml` para o caso de uma máquina
precisar das duas modalidades (terminal + relógio) — mas a senha de admin do próprio relógio REP-C
nunca tinha sido um campo da tela "Editar dispositivo REP". `montarConfigDispositivo` sempre
gravava `usuario_rep: admin` e um placeholder `PREENCHA_A_SENHA_DE_ADMIN_DO_RELOGIO` no zip
baixado, e o texto de ajuda da própria tela dizia isso explicitamente: "a senha do relógio ainda
precisa ser preenchida à mão". Reintroduzia, para essa credencial específica, exatamente o tipo de
edição manual pós-download que a v1.48.2 tinha acabado de fechar para as outras seções.

- Migration `20260811200000`: `dispositivos_rep` ganha `usuario_rep` (default `admin`),
  `senha_rep`, `porta` (default 443) e `usa_https` (default true).
- `senha_rep` é guardada em **texto claro**, não como hash — precisa ser recuperável para ser
  reembutida no `config.yaml` a cada clique em "Baixar aplicativo". Não é a mesma situação do PIN
  do servidor (`bcrypt`, propositalmente irrecuperável): aqui a credencial é de um equipamento
  administrado pela própria unidade, protegida pela mesma RLS de admin/super_admin que já controla
  toda a gestão de `dispositivos_rep`, e nenhuma dessas duas telas amplia quem pode vê-la.
- A tela nunca devolve a senha salva de volta ao formulário: `listarDispositivosRep` não seleciona
  `senha_rep` (evita trafegar o texto claro até o navegador só para preencher uma lista), e o campo
  de senha do modal de edição sempre começa em branco, com placeholder "deixe em branco para
  manter". Deixar em branco ao salvar preserva o valor já gravado; digitar algo substitui.
- `POST /api/coletor-rep/download` deixou de aceitar `endereco_ip` do corpo da requisição — para
  tipo `dispositivo`, passou a ler `endereco_ip`, `usuario_rep`, `senha_rep`, `porta` e `usa_https`
  direto de `dispositivos_rep` pelo `id`. Efeito colateral corrigido de quebra: antes o download
  usava o que estava digitado no formulário React no momento do clique, que podia divergir do que
  de fato estava salvo no banco se o admin tivesse esquecido de clicar em "Salvar alterações"
  antes de baixar. Agora o zip sempre reflete o que está persistido — e a tela avisa isso
  explicitamente perto do botão.

## 3. Exclusão de Terminal Local / Dispositivo REP

Só existia edição (ativar/desativar, `Pencil`). Pedido do usuário: um botão de excluir de verdade,
não só desativar.

- **Terminal local**: exclusão sempre segura — nenhuma tabela tem FK para `terminais_locais.id`
  (a marcação registrada por ele carrega `origem = 'terminal'`, igual ao terminal clássico, sem
  vínculo de volta ao terminal que a originou). `excluirTerminalLocal` faz `DELETE` direto.
- **Dispositivo REP**: `rep_afd_registros`, `rep_sincronizacoes` e `marcacoes_ponto` referenciam
  `dispositivo_id` com `NOT NULL REFERENCES ... ` sem `ON DELETE CASCADE` — de propósito, é
  registro de ponto retido por 5 anos (CLAUDE.md). O Postgres recusa o `DELETE` com violação de FK
  (`23503`) assim que existir qualquer AFD ingerido para aquele dispositivo. `excluirDispositivoRep`
  deixa o banco ser a fonte de verdade dessa regra (não duplica a checagem em código) e só traduz o
  erro cru em uma mensagem que explica o motivo e sugere desativar em vez de excluir. Um
  dispositivo de teste sem histórico real (o caso que motivou o pedido) exclui normalmente.

## Notas de perguntas feitas na sessão (sem mudança de código associada)

- **Só o IP identifica o relógio?** Não — a essa altura, endereço/porta/HTTPS **e** usuário/senha
  de admin do relógio (o item 2 acima). O IP sozinho localiza o dispositivo na rede; login.fcgi
  ainda exige a credencial.
- **Dá para descobrir o IP automaticamente?** Não implementado nesta rodada. Seria varredura de
  rede local (broadcast/mDNS ou scan de porta), e a maioria dos REP-C já sai da instalação com IP
  fixo definido pelo técnico que configura o relógio — o ganho é menor do que o esforço de
  implementar e testar contra hardware real de novo.
- **Outras marcas de relógio funcionam do mesmo jeito?** Não. `rep/client.go` fala com as rotas
  `.fcgi` proprietárias da Control iD (`login.fcgi`, `get_afd.fcgi?mode=671`), documentadas como
  "nomes de campo não confirmados oficialmente, só validados contra o hardware real" (CLAUDE.md).
  Outra marca (Henry, Topdata, ZKTeco, etc.) fala outro protocolo — dar suporte a uma segunda marca
  é escrever um client novo em `rep/`, não um parâmetro de configuração.
