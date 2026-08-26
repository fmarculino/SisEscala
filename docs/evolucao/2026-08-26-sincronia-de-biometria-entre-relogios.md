# A cópia de biometria entre relógios, confirmada em campo (26/08/2026)

Piloto de múltiplos relógios na **SMS**, par **Almox-Pat-CAF-01 → CAF-02**. O objetivo era sair
com a sincronia automática validada, para replicar nas outras unidades que têm mais de um
equipamento. O pendrive passou a ser contingência, não o caminho.

## O erro que abriu o caso

Exportar os usuários do 01 por pendrive e importar no 02 falhou na tela do equipamento:

```
Log de Erro na Importação de Usuários realizada em 26/08/26 17:30:20
Header invalido: primeiro campo deve ser 'pis'
```

Não é arquivo corrompido. **Os dois relógios identificam por campos diferentes**, e o CSV de
"Enviar/Receber usuários" carrega o nome do campo no cabeçalho. Medido pelos dígitos
verificadores do snapshot de cada um:

| | cadastros | com digital | validam CPF | validam PIS |
|---|---|---|---|---|
| CAF-01 | 55 | 49 | **55** | 6 |
| CAF-02 | 147 | 95 | 51 | **101** |

Os 51 que validam CPF no 02 são os que o SisEscala empurrou por API; os outros 96 são cadastro
legado do sistema anterior, por PIS. É a armadilha 10 aparecendo pela terceira vez, agora na
importação por arquivo: **o tipo de identificador é propriedade de como cada equipamento foi
cadastrado, não do AFD.**

Contingência gerada em `dadosrelogio/para-relogio-02/usuarios` — só o cabeçalho muda (`cpf;` →
`pis;`), byte a byte idêntico no resto, ISO-8859-1 e CRLF preservados.

## O que realmente travava a sincronia automática

A cópia automática **já tinha rodado sozinha** naquele dia, às 15:48, e falhado nos 45
servidores. As mensagens estavam gravadas em `rep_biometria_copias`:

```
add_users:[{pis,templates}]   -> recusado: PIS já cadastrado: 25575309215
add_users:[{cpf,templates}]   -> recusado: 'pis' em formato incorreto
add_templates / set_templates -> recusado: Invalid command
```

⚠️ **`add_users.fcgi` é CRIAÇÃO, não atualização** — e esse foi o achado que destravou tudo. Ele
nunca recusou o *formato*: recusou a *duplicidade*. Contra alguém que já está no relógio — que é
sempre o caso desta operação, que por regra nunca cria usuário — ele não tinha como funcionar.
Nenhuma quantidade de ajuste no corpo do template resolveria.

Sondagem dos comandos, um a um, com corpo vazio (corpo vazio não escreve nada):

| comando | resposta | leitura |
|---|---|---|
| `add_templates` · `set_templates` · `update_templates` · `add_user_templates` · … | `Invalid command` | não existem neste firmware |
| **`update_users`** | `'users' em formato incorreto` | **existe** — erro de campo, não de comando |

`update_users.fcgi` era o único comando de **atualização** da família, e não estava na varredura.

## Confirmação contra hardware real

Em duas metades, para separar o que precisava de digital do que não precisava:

1. **Formato do corpo**, sem digital nenhuma: alterando só o `name` do descartável
   "SISESCALA TESTE - PODE APAGAR" e restaurando depois. Aceito no primeiro candidato,
   `{"users":[{"pis":N,"name":"...","registration":N}]}`.
2. **Gravação de template**, no caso exato do dia a dia: pessoa já cadastrada no 02 **sem**
   digital, recebendo a que já tinha no 01 — com a digital indo para o **próprio dono**, nunca
   para cadastro alheio. As três condições do `descobrirFormatoTemplate` conferidas por
   relistagem: a digital chegou no alvo, **só** o alvo ganhou digital, e o cadastro não cresceu
   nem encolheu.

Descoberto de quebra: **`add_users` grava o template junto na criação**. Relógio novo pode receber
cadastro e digital numa operação só — o que importa para as unidades que ainda vão ganhar o
segundo equipamento.

Resultado: **CAF-02 com 55 usuários e 49 digitais, idêntico ao 01**, zero divergências.

## O buraco que os testes revelaram

⚠️ **`descobrirFormatoTemplate` detectava se o cadastro CRESCEU, nunca se ENCOLHEU.** Um formato
que apagasse cadastro caía no ramo "aceito mas não gravou nada" e a varredura **seguia tentando o
candidato seguinte** em cima de um relógio que acabara de perder usuário. Agora aborta, nomeando
quem sumiu (reusa `identificadoresAusentes`, que a remoção já usava).

Isso importa mais para as próximas unidades que para esta: aqui o primeiro candidato acerta e a
varredura nem roda. Em firmware diferente, a varredura **é** o mecanismo.

⚠️ **Um candidato perigoso foi removido antes de rodar**: mandava `templates` sem
`name`/`registration`. Se algum firmware tratar `update_users` como substituição do objeto
inteiro, o cadastro perde nome e matrícula — e a conferência por relistagem **não pegaria**: ela
olha biometria e tamanho do cadastro, não os campos de quem ficou.

## Destravada no ciclo automático

`SincronizarBiometriaTodos` entra no ciclo, ao lado dos cadastros, com `LimiteBiometriaPorCiclo`
(10) — a constante já existia, preparada para isto. O critério é o mesmo que autorizou os
cadastros: **a fila é o gatilho.** Sem ninguém faltando digital,
`fn_biometria_faltante_dispositivo` devolve lista vazia e nada é escrito no equipamento; o custo
em repouso é um GET.

A ordem importa: o cadastro cria a pessoa no destino, e só quem já está lá **sem** digital é
candidato a receber.

ℹ️ Ao investigar por que a função devolvia zero pendentes com 45 pessoas faltando digital: ela
ignora quem falhou nas últimas **24h**. As 45 falhas das 15:48 bloqueavam a retentativa até o dia
seguinte. É proteção contra repetir o mesmo erro a cada 5 minutos, não bug.

## Indicador por relógio na bandeja

O ícone da bandeja é **um só para a máquina**, então ele agrega — e o agregado esconde justamente
o caso que passou a ser comum: três equipamentos respondendo e um mudo. `ciclo/todos.go` já
acumulava os erros por relógio, mas isso nunca chegava à tela.

Cada linha do menu agora tem bolinha verde/vermelha e diz `— online` ou `— SEM RESPOSTA`.

⚠️ **A primeira tentativa usou emoji no título e saiu cinza em campo** (v0.11.0). Essas linhas são
`Disable()` — não há o que clicar nelas —, e o Windows esmaece o item desabilitado **inteiro**,
emoji junto: `🟢` e `🔴` ficavam indistinguíveis. Corrigido na v0.11.1 com `MenuItem.SetIcon`, que
o Windows desenha como `hbmpItem`, separado do texto, mantendo a cor. São os mesmos `.ico` 16×16
já embutidos para a bandeja — 16×16 é justamente o tamanho de ícone de menu, então não houve
asset novo.

A cor **nunca vai sozinha**: o veredito está no próprio título, para quem não distingue verde de
vermelho ou usa tema de alto contraste.

⚠️ Para isso o heartbeat precisou **separar duas conexões que fundia num erro só**: máquina →
relógio e máquina → SisEscala. `HeartbeatComEstado` devolve `RelogioOK` à parte, e as linhas são
pintadas mesmo quando o heartbeat falhou — o erro pode ser do SisEscala, e saber *quais*
equipamentos respondem é o que resolve o chamado.

Sem ciclo nenhum ainda, a linha sai **sem** indicador: dizer "offline" para um relógio que só não
foi consultado ainda seria pior que não dizer nada.

## O incidente do pacote da unidade

No mesmo dia, "Baixar pacote da unidade" derrubou **REP iDClass - SMS** e **REP iDClass -
Reg/TI/TFD** por 2h49. Os tokens dos dois foram rotacionados às **15:32:45** e **15:32:49**, e o
último contato de cada um foi exatamente aí.

Causa: os 4 relógios são da mesma unidade (SMS), e `gerarTokensUnidadeRep` rotacionava o token de
**todos os ativos** — tudo ou nada. Gerar token substitui o anterior, então todo equipamento que
entra no pacote para de sincronizar até alguém instalar o arquivo naquela máquina. Quem recebeu o
pacote voltou; quem não recebeu ficou mudo.

A regra `config.Mesclar` ("nunca perder um relógio") funcionou como projetada e **preservou** as
entradas de SMS e Reg/TI/TFD no `config.yaml` — só que com tokens já invalidados. Preservar a
entrada não preserva a credencial.

Correção: **a tela passa a deixar escolher quais relógios entram no pacote**, com todos marcados
por padrão (o caso dominante continua sendo uma máquina que enxerga a unidade inteira). A action
aceita a lista e **confere contra a unidade** em vez de aceitar como veio — armadilha 12 de novo:
tela filtrada não protege a action, que é um POST chamável direto.

⚠️ Nada disso perde marcação. O AFD fica no equipamento e é coletado quando o coletor volta.

## Versão

v0.11.1 — `ciclo.Versao`, `dist/VERSION` e os dois `.exe` recompilados (tray com
`-H=windowsgui`, subsystem conferido: 2 no tray, 3 na CLI).
