# SisEscala 📅[![Version](https://img.shields.io/badge/version-2.27.3-green.svg)](https://github.com/fmarculino/SisEscala)
[![Next.js](https://img.shields.io/badge/framework-Next.js%2015-black.svg)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/backend-Supabase-green.svg)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/styling-Tailwind%20CSS-38B2AC.svg)](https://tailwindcss.com/)

O **SisEscala** é uma plataforma robusta de gestão de escalas de trabalho e controle de presença, projetada especificamente para atender às complexidades de órgãos públicos e unidades de saúde que operam em regime multi-setorial e multi-unidade.

O sistema foca em **governança, segurança jurídica e eficiência operacional**, automatizando desde a criação da escala até o processamento de trocas e auditoria de presença.

---

## 🚀 Principais Funcionalidades

### 🔐 Endurecimento de Segurança (v2.24.0 → v2.27.0)
Uma auditoria de segurança sobre todo o código foi verificada achado a achado contra o sistema real e executada em quatro entregas. As correções tocam **quem consegue entrar, quem consegue ver e quem consegue agir em nome de outra pessoa** — nenhuma delas altera o cálculo de ponto, de escala ou de folha, e essa fronteira foi mantida de propósito para que a correção fosse reversível.

- **Portal do Servidor com sessão assinada.** A sessão passou a ser um cookie assinado por HMAC, e **toda** ação do portal deriva a identidade dele — em vez de recebê-la do navegador. A busca por matrícula deixou de devolver o identificador interno, e a validação de PIN passou a receber a matrícula.
  - ⚠️ A decisão que importa é **derivar em vez de comparar**: comparar funciona, mas exige que cada ação nova lembre de fazê-lo. Derivar torna o erro impossível de cometer.
- **Envio de WhatsApp e e-mail exige sessão.** O motor de envio saiu do arquivo de Server Actions e virou código de servidor comum, alcançável só por quem o importa — o cron de avisos e o webhook continuam funcionando. A opção de sobrescrever configuração na hora ficou restrita ao caminho de **teste**, que exige administrador. A validação de certificado TLS do SMTP foi ligada.
- **Segredo deixou de ser legível por qualquer conta logada.** A senha do SMTP e a chave de API de WhatsApp passaram a exigir papel administrativo. ⚠️ A parte não óbvia: **19 das chaves sensíveis são blobs JSON com a credencial aninhada dentro do valor** — uma regra por nome de chave não as alcançaria.
- **Bloqueio de PIN mudou para o banco.** A regra de 5 tentativas / 15 minutos vivia na aplicação e era contornável; agora a decisão inteira acontece numa transação só. Equivalência com a regra anterior provada em **352 estados**, com zero divergências.
- **Relatórios deixaram de imprimir texto do banco sem escape.** Os cinco geradores passaram a usar uma montagem de HTML que **escapa por omissão** — esquecer de marcar um fragmento faz a tag aparecer como texto na tela, em vez de executar.
- **Cabeçalhos de segurança** (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) e **CSP em modo Report-Only** — que relata sem bloquear, porque uma política em modo bloqueio quebraria os relatórios e, pior, o terminal de ponto, que fica aberto por dias sem recarregar.
- **Acesso anônimo às funções de tela fechado.** ⚠️ Cada função foi **medida** antes de qualquer alteração, e a maioria já recusava sozinha — o que vazava era a que não filtrava por escopo. Quatro funções usadas dentro das regras de acesso do banco ficaram intocadas de propósito: revogá-las derrubaria a aplicação inteira, não a degradaria.
- **A fila do relógio de ponto confere de quem é o item confirmado**, para que um equipamento não confirme cadastro pendente de outro.

Cada correção veio com um **portão** que reprova a regressão correspondente, e todos foram validados quebrando o código de propósito para confirmar que falham. Conferência em um comando: `node scratchpad/conferir_seguranca.mjs`.

### 🗂️ Excluir Setor Transferindo os Vínculos (v2.23.0)
- **Setor cadastrado errado agora tem saída, mesmo com gente dentro.** A exclusão que existia só alcançava setor sem vínculo nenhum — na prática, **200 dos 646 setores**. Entre os já **inativos**, que são justamente os que se quer tirar do cadastro, **7 estavam presos para sempre**: o sistema listava os vínculos e não oferecia nada a fazer com aquela informação.
- **Agora o Administrador Geral escolhe um setor de destino** e todo o vínculo passa para ele — servidores lotados, escalas, acessos, relógios, terminais, subsetores, marcações de ponto e histórico — e só então o setor é apagado.
- ⚠️ **Não existe "excluir em cascata", e a ausência é deliberada.** As maiores tabelas presas a um setor são marcações de ponto, escalas e servidores: apagar em cascata seria destruir registro de ponto, que é prova legal (Portaria 671/2021), para resolver um problema de cadastro. Transferir muda o dono e não perde nada.
- **A transferência é recusada em bloco** quando não é segura: destino em outra unidade (isso é transferência de servidor, tem tela própria), destino que é subsetor do próprio setor, ou o mesmo servidor com escala nos dois setores na mesma competência — que juntaria as horas duas vezes na folha. O motivo aparece na tela **antes** de confirmar, enquanto ainda dá para trocar o destino.

### 🌳 Seleção de Setores em Árvore (v2.23.0)
- No cadastro do relógio de ponto, **clicar num setor pai marca ou desmarca todos os subsetores dele**. O pai mostra estado parcial e o contador de quantos filhos estão marcados.
- Expandir e recolher por ramo, "Marcar todos", "Limpar" e busca por nome. O maior hospital tem **196 setores em 40 raízes e 3 níveis** — a lista plana anterior obrigava a marcar dezenas de caixas uma a uma.
- A tela **Organização (Setores)** ganhou o mesmo tratamento: expandir/recolher tudo por unidade e o **card da unidade inteiro recolhível**, com contador de unidades abertas.

### 🚫 Inativo Sai da Escolha e Fica no Filtro (v2.23.0)
- **Desativar uma unidade ou um setor passou a alcançar os formulários.** Antes, a unidade desativada continuava aparecendo no cadastro do relógio como se nada fosse — dava para vincular um equipamento a um cadastro já aposentado.
- **Onde se escolhe onde algo vai ficar** (relógio, terminal, escopo de usuário, transferência, lotação), o inativo não é mais oferecido. **Nos filtros de listagem e relatório ele continua**, marcado como `(inativo)`: escala, folha e ponto registrados naquele setor não deixaram de existir, e sem a opção no filtro ficariam inalcançáveis.
- ⚠️ **O que já está selecionado nunca some**, mesmo inativo — senão o próximo "Salvar" gravaria uma troca que ninguém pediu.

### 🖥️ IP da Máquina do Coletor (v2.23.0)
- A tela de Marcações já mostrava o **nome** do computador onde o coletor está instalado, e o nome não leva ninguém até ele: não há DNS interno cobrindo as unidades. O IP que aparecia é o **público da unidade** — as cinco máquinas de um mesmo hospital apareciam todas com o mesmo endereço.
- Agora o coletor (**v0.13.0**) reporta o **IP dele na rede da unidade**, que é por onde o suporte alcança a máquina.

### 🔗 "Onde Estão as Horas" Leva à Escala (v2.23.0)
- No relatório de Carga Consolidada, cada linha da composição virou link direto para a grade daquele setor e competência. Quem aparece ali está **acima do teto** — alguém precisa abrir a escala para reduzir, e o caminho era decorar unidade e setor e procurar.

### ⚡ Sobreaviso Vencido Não Aciona Mais (v2.23.0)
- O histórico de acionamentos de um plantão que já passou é **só para consulta**: o botão de novo acionamento fica desabilitado fora da janela do plantão, dizendo qual era a janela e apontando a **Validação Manual** como caminho para registrar atendimento passado.
- O acionamento nunca chegava a ser gravado (o banco já recusava), mas a tela convidava a tentar — e o usuário só descobria depois de escrever o motivo do chamado.

### ⏱️ Teto de Horas Consolidado Entre Escalas (v2.22.0)
- **Correção crítica**: o teto de 300h/mês por servidor (Configurações → Regras) sempre foi um limite **da pessoa**, mas a única conta que o defendia era a da **grade aberta**. Servidor escalado em dois setores tinha duas contas dentro do teto e uma soma fora dele — caso real: 289h no `SHL \ ACOLHIMENTO` mais 120h na `SHL \ LAVANDERIA` do HMI, **409h**, com as duas telas mostrando um número válido.
- **A checagem alcançava um caminho só**: apenas a digitação célula a célula conferia o teto. **Aplicar Template**, **Gerador Inteligente** e a gravação de meses futuros nunca consultaram nada, e não havia trava no banco.
- **Agora a conta é do mês inteiro da pessoa**, somando todas as escalas da competência — entre setores e entre unidades. A coluna **TOTAL H/MÊS** ganhou as linhas **Outras** e **Mês**, com tooltip dizendo `UNIDADE / SETOR — Nh`, e fica vermelha acima do teto; um **escudo vermelho** ao lado do nome abre a Autorização Extraordinária. Ao **adicionar** um servidor à grade, o sistema avisa na hora quanto ele já tem em outro lugar — antes de lançar o mês dele.
- **A Autorização Extraordinária passou a ser uma por servidor/mês**, não por unidade: duas unidades concedendo +100h cada elevariam o teto a 500h sem que ninguém tivesse decidido isso.
- **Aplicar Template e Gerador Inteligente são tudo ou nada**, e o Gerador **nomeia quem recusou e por quê** — o teto é o único motivo de recusa que depende de outra escala, e sem dizer isso o coordenador olha a própria grade, vê espaço sobrando e não entende nada.

### 📊 Relatório de Carga Consolidada do Mês (v2.22.0)
- **Responde a pergunta fora da grade**: quem está em mais de uma escala na competência, quanto dá no total e onde estão as horas. Sem ele, a informação só existia para quem abrisse justamente uma das duas grades — conferir o mês exigiria abrir todos os setores.
- **Sem filtro de unidade ou setor, de propósito**: a pergunta é quanto **a pessoa** tem no mês, e a resposta cruza setores por definição — filtrar devolveria a conta parcial que o relatório existe para corrigir.
- Mostra o total, o teto efetivo, a situação (dentro do teto / autorizado / acima) e a composição escala a escala, com o caminho completo do setor.

### 🔀 Avaliação de Transferência pelo RH (v2.22.0)
- **RH Geral avalia qualquer solicitação; RH da Unidade avalia dentro das unidades dele.** Antes, aprovar ou rejeitar era exclusividade do Administrador Geral. Os demais perfis continuam apenas solicitando.
- **Correção de segurança**: a policy que dizia "avaliação só do Administrador Geral" **nunca restringiu nada** — outra policy `FOR ALL` na mesma tabela se somava a ela com `OR`, e `FOR ALL` cobre `UPDATE`. Na prática, quatro perfis podiam marcar um pedido como aprovado chamando a API direto; o que os segurava era só a verificação da tela.
- **RH da Unidade só aprova com origem e destino dentro do escopo dele**, conferidos pelo valor final — o do pedido ou o que ele acabou de escolher no formulário da aprovação.

### 🧭 Caminho Completo de Setor (v2.22.0)
- **Nome de setor sozinho não identifica setor**: "BLOCO A" existe embaixo de mais de um pai. A saída que vinha sendo usada era batizar o cadastro de "BLOCO A SHL" — escrever a hierarquia dentro do nome, duplicando o que a árvore já sabe.
- As listas e os textos passam a mostrar `SHL \ BLOCO A`. A **barra invertida** é deliberada: a tela já usa `" / "` entre unidade e setor, e repetir a barra normal apagaria essa fronteira.
- Aplicado em Pendências de Cadastro, na lista de Escalas e no cabeçalho e PDF da grade. Demais telas seguem na fila.

### 📋 Justificativa Coletiva Autorizada pelo RH (v2.21.0)
- **Autorização nominal, com ofício obrigatório**: o RH Geral libera, **por servidor** e por período, quais passos de ponto o coordenador pode declarar em massa — nunca por setor, para que servidor novo não herde dispensa que ninguém concedeu. Caso de origem: os técnicos do Programa Porta a Porta, que iniciam a jornada de madrugada em campo e não passam na sede para registrar a entrada.
- **A batida de saída nunca é dispensada**: `CHECK` no banco impede `saida` na lista de passos, e nenhum caminho do modo restrito toca nesse campo. A saída continua vindo do relógio, biométrica.
- **Não é marcação automática**: o que se grava é declaração do coordenador, com justificativa, rotulada como **manual** na folha — o mesmo tratamento do Art. 82, parágrafo único, que a validação manual já usava. O que a versão acrescenta é a **autorização prévia do RH como pré-condição**, conferida no banco e não só na tela.
- **A folha imprime o ofício**: `REGISTRO DE ENTRADA DISPENSADO CONF. OFÍCIO 249/2026` na observação do dia — é o documento que responde à fiscalização.
- **Vigência com prazo**: obrigatória e limitada a 12 meses, renovável por novo ato; revoga-se, nunca se apaga.

### 🔒 Fechamento do Acesso Anônimo às Funções de Ponto (v2.21.0)
- **Correção crítica**: funções como `fn_confirmar_presenca`, `fn_registrar_ponto` e `fn_atestar_jornada_bulk` eram executáveis com a chave `anon` — a mesma que vai no bundle do navegador —, o que permitia gravar presença em folha de ponto **sem nenhum login**.
- **A causa era o padrão de GRANT**: no PostgreSQL, `CREATE FUNCTION` já concede `EXECUTE` a `PUBLIC`, então `GRANT ... TO authenticated` nunca restringiu nada. Das 394 funções do schema, **369 eram alcançáveis por anon**; hoje são 324, e as que escrevem sem conferir papel caíram de 35 para 4 — todas do fluxo público de sobreaviso, que exigem `magic_token`.
- **Migration de privilégio que confere o próprio resultado**: `REVOKE` de quem não é dono da função não falha, apenas emite `WARNING` — uma correção pode "aplicar com sucesso" sem mudar nada. As migrations passaram a verificar `has_function_privilege` **nos dois sentidos** e abortar: se anon continuar entrando, ou se uma função que a tela usa perder o acesso de quem está logado.

### 🚪 Terminal Clássico Realmente Desativável (v2.21.0)
- **A chave passou a desligar o recurso, não só o botão**: até aqui `terminal_classico_habilitado = false` apenas escondia o link na sidebar e no login — a rota continuava servida e a função de registro continuava alcançável, então quem tinha o endereço nos favoritos seguia batendo ponto.
- **Três camadas**: o banco recusa antes de qualquer escrita e antes de conferir o PIN; o middleware não serve mais a rota; a tela mostra "Terminal Desativado". O **Terminal Local não é afetado** — tem canal próprio, com token de dispositivo e escopo de unidade/setor.
- ⚠️ **Não é restrição de horário** (vedação da Portaria MTP 671/2021): nada aqui olha a hora da batida. Onde o canal está ligado, a regra de nunca recusar batida por horário continua intacta.

### 📄 Verso da Folha Só com Justificativas Reais (v2.21.0)
- **O relatório de ocorrências deixou de listar fim de semana**: ele incluía todo dia com observação preenchida, e a geração da folha escreve `SÁBADO`/`DOMINGO`/`FOLGA` sozinha em cada dia sem escala. Nas 482 folhas de agosto/2026 eram **11.505 linhas, das quais 6.216 de fim de semana**, todas assinadas como "Gestão / Coordenação" — o documento afirmava que alguém justificou o que ninguém justificou.
- **Ficam 4.838 linhas**: ajustes manuais, afastamentos, observações escritas por pessoas e jornadas temporárias. **Trabalho em feriado passa a aparecer** com o horário; feriado sem trabalho é calendário e sai.
- **A parte humana é preservada** quando vem colada ao rótulo (`AFASTAMENTO PARCIAL: ... | SÁBADO`), e nenhum dado é alterado — o verso é derivado dos registros na renderização.

### 🛠️ Gestão de Cadastros e Escala (v2.21.0)
- **Exclusão de setor pelo Administrador Geral**: apenas para setor **sem nenhum vínculo**, e a recusa **lista o que o segura**. A varredura é dinâmica sobre as chaves estrangeiras do banco, porque parte delas é `ON DELETE CASCADE`/`SET NULL` e um `DELETE` direto apagaria dado real em silêncio.
- **Busca direta de servidor em Afastamentos**: campo incremental por nome, matrícula ou CPF que preenche unidade e setor ao escolher — com 1.318 servidores ativos, o RH não tem como saber a lotação de cada um de cabeça.
- **RH Geral e RH da Unidade editam a grade fora do prazo de planejamento**, como o Diretor. Os dropdowns de escolha de setor deixam de oferecer setores inativos, e os filtros da tela de usuários passam a casar por **lotação ou vínculo explícito**, em vez do escopo de permissão com coringas.

### 👥 Gestão de Usuários pelo RH, com Escopo Real (v2.8.0)
- **RH Geral e RH da Unidade passam a cadastrar usuários**: o item **Usuários** foi liberado no menu SISTEMA para os dois perfis de RH — Configurações, Backup e Segurança seguem exclusivos do Administrador Geral, e Diretor, Coordenador e Ass. Administrativo continuam sem acesso à tela.
- **RH Geral** administra todos os usuários **exceto os de perfil Administrador Geral**. **RH da Unidade** enxerga apenas as contas cujo escopo cabe inteiro dentro das unidades dele, e só atribui papéis escopados por unidade — não consegue criar uma conta com alcance maior que o próprio.
- **Autorização nas server actions, não só na tela**: as cinco actions de gestão de usuários passaram a verificar papel e escopo por conta própria. Até aqui a única barreira era o `if` da página — e server action é um endpoint POST cujo id sai no bundle do cliente.
- **Excluir usuário continua exclusivo do Administrador Geral** (irreversível e sem log); o RH inativa, que é reversível e auditado. Redefinir senha e ativar/inativar valem dentro do escopo.

### 🍽️ Intervalo do Plantão é Propriedade do Turno, Não da Jornada (v2.8.0)
- **O intervalo intrajornada do plantão deixa de ser herdado da jornada Regular do servidor**: como toda jornada de até 6h tem `intervalo_minutos = 0` — correto para o expediente dela —, esse zero anulava o guard do Art. 71 em **qualquer** plantão daquela pessoa, de qualquer duração. Dois servidores no mesmo turno de 12h recebiam tratamento diferente conforme o contrato de cada um.
- **Nova coluna `dicionario_turnos.intervalo_minutos` e piso derivado da duração** (`fn_intervalo_minimo_legal`): o piso é o que torna a regra impossível de esquecer — um código de plantão não cadastrado não volta a ser o bug. O cadastro serve apenas para elevar o intervalo acima do piso, nunca para rebaixá-lo.

### 🕘 Alteração de Jornada no Meio da Escala com Vigência por Data (v2.3.0)
- **Dois caminhos, porque são dois fatos diferentes**: a jornada do mês (`escala_mensal.jornada_id`) vale para **todos os dias**, então trocá-la no dia 12 reavalia também os dias 1 a 11. Ao alterar a jornada de um servidor que já tem ponto registrado, a grade passa a exigir a escolha entre **"passou a cumprir o novo horário a partir do dia X"** (redução judicial, acordo, mudança de setor — cria vigência por data e preserva os dias anteriores) e **"a jornada estava errada desde o dia 1"** (erro de cadastro — reescreve o mês, com justificativa obrigatória).
- **Histórico Auditável da Troca (`escala_mensal_jornada_historico`)**: tabela append-only que registra valor anterior, valor novo, autor, data e justificativa de toda alteração efetiva de jornada, inclusive as feitas pelo salvamento normal da grade.
- **Vigência Determinística e Sem Sobreposição**: `obter_jornada_servidor_data` — a função consultada por dentro de `fn_confirmar_presenca` e `fn_blocos_previstos_dia`, e portanto respeitada por terminal, REP, reconciliação e folha — passa a ordenar explicitamente (a decisão mais recente vence), e períodos sobrepostos para o mesmo servidor são recusados no banco.
- **Carga Horária Correta com Jornadas Diferentes no Mesmo Mês**: o total de horas normais da folha passa a resolver a jornada **dia a dia** (fonte única em `src/utils/folha/cargaDiaria.ts`), em vez de aplicar a jornada do mês a todos os dias.
- **A Mudança Permanente Sobrevive à Virada do Mês**: o Gerador Inteligente passa a herdar a jornada vigente no último dia do mês anterior, e não mais a jornada do cadastro mensal — que desfazia silenciosamente a alteração na virada.

### 📄 Verso da Folha de Ponto & Relatório Anexo de Plantão/Sobreaviso (v2.2.0)
- **Verso Oficial da Folha de Ponto**: Quadro analítico com detalhamento completo de ocorrências, justificativas registradas, atestados, declarações e histórico funcional para prestação de contas aos órgãos fiscalizadores.
- **Relatório Anexo de Plantão e Sobreaviso (`RelatorioPlantaoSobreavisoAnexo.tsx`)**: Relatório gerado em PDF/impressão consolidando plantões extras e escalas de sobreaviso cumpridas no mês, com cruzamento de justificativas de eventos e descrições do `dicionario_turnos`.
- **Acesso Seguro via Service Role**: Consultas administrativas de relatórios e anexos utilizando `createAdminClient` para evitar recortes indevidos de escopo RLS entre setores da mesma unidade.

### ⏱️ Afastamentos Fracionados (Por Horas) & Abono Parcial (v2.2.0)
- **Afastamento Fracionado (`tipo_periodo = 'horas'`)**: Permite cadastrar afastamentos com hora de início e término (`hora_inicio`, `hora_fim`), possibilitando abonar saídas antecipadas, consultas médicas ou convocações pontuais.
- **Cálculo Preciso de Horas**: Dedução proporcional das horas abonadas sem anular o restante do expediente trabalhado no dia, com integração automática na Folha de Ponto, Grade de Escalas e Portal do Servidor.

### 🕐 Reconciliação em Massa de Marcações REP & Duplo Vínculo (v2.2.0)
- **Resolução de Identidade com Escopo de Unidade**: `fn_servidor_por_identificador_afd` desfaz ambiguidades quando um mesmo CPF possui duplo vínculo funcional ativo no município, associando a batida à unidade correta do relógio.
- **Auto-Reconciliação Instantânea**: A ingestão de arquivos AFD do REP dispara automaticamente a reconciliação das marcações, atualizando o espelho de ponto em tempo real.
- **Reprocessamento Retroativo de Batidas Órfãs**: Rotina que recupera e vincula automaticamente marcações históricas do AFD assim que novos servidores são cadastrados ou vinculados.

### 🔄 Coletor REP v0.7.0 & Automação de Higiene
- **Higiene Automatizada em Background**: O ciclo do coletor (5 min) executa remoções pendentes no hardware REP e confirma a exclusão por relistagem sem exigir intervenção do usuário.
- **App de Bandeja (Tray) com Menu Completo**: Ações rápidas no Windows para sincronização forçada, disparo de rotina de higiene e status em tempo real.
- **CI/CD no GitHub Actions**: Pipeline automatizado que compila os binários Go para Windows e executa checagens estáticas de tipos e lint a cada push.

### ⚙️ Correções de Presença, Isolamento do Sobreaviso & Intervalo Flexível (v1.21.0)
- **Intervalo Flexível por Servidor**: nova flag no cadastro que libera o gozo do intervalo em **qualquer horário**, mesmo em unidades de intervalo **Rígido**, desde que a carga horária líquida seja cumprida. A saída passa a ser calculada dinamicamente (`fim previsto + excedente do intervalo`): jornada 08h–18h com 2h previstas, saindo 14h e voltando 17h, encerra às 19h.
- **Sobreaviso Isolado do Registro de Presença**: o sobreaviso deixa de ser fundido no bloco de trabalho contínuo, que travava a batida de saída do expediente. `Regular`, `Extra` e `Plantão` seguem fundindo entre si normalmente. O ciclo do sobreaviso (acionamento → aceite → chegada) permanece integralmente em `logs_sobreaviso`, com barreira definitiva no banco (`chk_sobreaviso_sem_presenca`).
- **Guard de Intervalo Intrajornada (CLT Art. 71)**: restaurada a proteção que impede jornadas de **4h e 6h** de receberem o fluxo de 4 batidas, o que fazia a saída real ser gravada como "saída para intervalo". Regra centralizada em `fn_jornada_tem_intervalo`, aplicada ao terminal, à marcação manual, à validação em massa e à grade de escala.
- **Recuperação de Batidas Recusadas**: saídas legitimamente registradas e recusadas por falha do sistema foram reconstruídas a partir de `logs_tentativas_presenca`, preservando o horário real da batida.

### ⚡ Correções de Cálculo do Turno T, Permissões RLS e Rótulos Dinâmicos (v1.19.1)
- **Cálculo da Hora de Início para Turno `T` (Jornadas 12h-18h)**:
  - Atualizadas as funções `fn_confirmar_presenca` e `fn_confirmar_presenca_manual` para avaliar dinamicamente o `start_hour` da jornada regular (ex: 12:00) quando a célula possui o turno `T`, ajustando a janela de presença para **11:30 às 12:30**.
- **Visualização de Tentativas Recusadas para Gestores**:
  - Nova política de segurança RLS (`Allow authorized users read logs`) na tabela `logs_tentativas_presenca`, permitindo que **Coordenadores e Administradores** visualizem o quadro vermelho com os motivos de recusa no modal de validação manual.
- **Rótulos Dinâmicos do Escopo de Validação**:
  - Substituídos os sub-rótulos estáticos e enganosos `(Manhã)` e `(Tarde)` por descrições dinâmicas de acordo com o turno do servidor naquele dia (`Manhã`, `Entrada Tarde`, `Entrada Noturna`, `1º/2º Turno`), garantindo clareza nos modais.
- **Suporte aos Escopos de Validação Manual**:
  - Suporte completo aos parâmetros `'completo'`, `'periodo_1'`, `'periodo_2'` na RPC `fn_confirmar_presenca_manual`, eliminando o erro de *"Tipo de presença inválido"*.

### ⚡ Validação em Massa de Presença & Governança de Ajustes (v1.19.0)
- **Validação em Multi-Níveis**:
  - **Nível 1 (Por Célula / Meio Período)**: Ações rápidas no modal da célula para homologação de batidas individuais, dia completo, 1º período (Manhã) ou 2º período (Tarde).
  - **Nível 2 (Por Servidor)**: Atalho `<CheckSquare />` na grade para validação por intervalo de datas específico para um servidor.
  - **Nível 3 (Global por Unidade)**: Botão `⚡ Validar em Massa` no topo da grade para homologação global em lote de múltiplos servidores.
- **Preservação Integral das Batidas Reais de Servidores**: Atualização da função RPC `fn_confirmar_presenca_manual` com `COALESCE` em todas as etapas para que batidas efetuadas via relógio de ponto não sejam sobrescritas, preenchendo e sinalizando como ajustes manuais apenas os horários faltantes.
- **Justificativa Obrigatória & Validação Manual de Sobreaviso**: Exigência de justificativa cadastrada em banco de dados para qualquer homologação manual de presença ou sobreaviso pendente/falhado.
- **Nomenclatura Padrão ("PREVISÃO" / "PREV")**: Atualização da denominação da grade (`ScaleGrid.tsx`), relatórios consolidados e ajuda de `PLANEJADO` para `PREVISÃO`.
- **Alerta de Recusas pelo Terminal**: Leitura dos logs de tentativas negadas exibindo selo ⚠️ e tooltip explicativo.

### ⏱️ Controle de Marcação de Intervalos (Pausas) por Unidade
- **Modos Flexível & Rígido**: Escolha por unidade se o intervalo intrajornada é livre (Flexível) ou fixado por horários rígidos, em total conformidade com o Art. 71 da CLT e Portaria MTP 671/2021.
- **Cascata de Resolução Híbrida (Modo Rígido)**: Resolução de horários priorizando a personalização no servidor $\rightarrow$ padrão da jornada $\rightarrow$ cálculo automático.
- **Grade de Escala Dinâmica (2 vs 4 Segmentos)**: Exibição de 4 batidas presenciais (Entrada, Saída Intervalo, Retorno Intervalo, Saída Final) na grade de escala e folha de ponto.
- **Governança & Segurança Jurídica**: Trava de reversão em batidas reais de terminal físico (exclusivas para Administradores) e descarte automático de 4 passos para jornadas curtas ($\le$ 4h).

### 💬 Comunicação Unificada: WhatsApp (Multi-Provedor) & E-mail (SMTP)
- **Integração WhatsApp API Multi-Provedor**: Suporte nativo ao **AstraCalls API**, **Chatwoot API** e **API HTTP Genérica Customizada** (com template JSON de payload e headers flexíveis para conectar a qualquer gateway como Evolution API, Z-API, WPPConnect, etc.).
- **Fallback Inteligente de Contingência**: Transição automática ou assistida para **WhatsApp Web / App (`wa.me`)** caso ocorra qualquer instabilidade ou erro na API do WhatsApp.
- **Governança de Comunicação (`/configuracoes`)**: Painel visual de gestão de credenciais e parâmetros de WhatsApp e Servidor de E-mail (SMTP) armazenados em `configuracoes_globais`, com modais de teste em tempo real antes de salvar.
- **Notificação de Acionamento e PIN**: Envio automático de acionamentos de sobreaviso (`ScaleGrid.tsx`) e PIN de acesso do servidor (`/servidores`).
- **Aviso de Ponto por WhatsApp (Opt-in)**: O servidor escolhe receber um resumo diário ou semanal das próprias batidas — frequência limitada a esses dois modos para controlar o volume de mensagem enviado pelo número institucional.

### 📄 Ficha Cadastral em PDF, Webcam & Dados Bancários
- **Ficha Cadastral Timbrada (`FichaServidorPrintView.tsx`)**: Gerador de Ficha Cadastral em PDF/Impressão com timbre oficial da Prefeitura de Marabá / SMS, foto 3x4, dados funcionais/pessoais/bancários e assinaturas físicas e digitais do servidor e RH.
- **Captura via Webcam (`WebcamPhotoCaptureModal.tsx`)**: Captura de foto do servidor com câmera HTML5 em tempo real (1:1 crop, preview e refazer sem tela preta) e lightbox preview em alta resolução.
- **Dados Bancários Completos**: Seção dedicada para controle de Banco, Agência, Conta Corrente, Tipo de Conta e Chave PIX para folha de pagamento.
- **Importação CSV Inteligente (`/servidores/importar`)**: Leitor flexível com suporte a delimitadores `,` e `;`, modelo baixável `.csv` e mapeamento dinâmico de todas as colunas do servidor.

### 🏖️ Gestão de Férias, Licenças & Requerimentos Oficiais
- **Solicitações Digitais de Férias e Licenças (`/ferias-licencas`)**: Módulo dedicado para abertura, tramitação e aprovação de requerimentos de férias, licença prêmio, licença médica, entre outros.
- **Validação de Duplicidade & Rastreamento**: Trava de duplicidade para o mesmo exercício e histórico de solicitações indeferidas e contrapropostas deferidas no Painel de Alertas.

### 🔐 Autenticação, Segurança & Recuperação de Senha
- **Recuperação de Senha PKCE**: Fluxo seguro de recuperação de senha via e-mail utilizando PKCE (`/auth/callback` e `/resetar-senha`) integrado com Supabase Auth.
- **E-mail Institucional SMTP**: Disparo de e-mails corporativos via Google Workspace (`informatica.sms@maraba.pa.gov.br`) com layout oficial da Prefeitura de Marabá / Secretaria Municipal de Saúde (`/api/templates/recovery`).
- **Internacionalização de Erros**: Tradução automática de todas as mensagens de erro do Supabase Auth para Português amigável.

### 📋 Gestão de Escalas Inteligente
- **Auto-Escala Inteligente (Fase 1)**: Motor inteligente para preenchimento de escalas com base na continuidade histórica de folgas do mês anterior (ideal para 12x36), bloqueio automático de dias de afastamento (férias, licenças) e preferências de turnos cadastradas.
- **Automação de Competências & Cron**: Rotinas de fechamento automático de escalas vencidas e geração de folhas de ponto rascunho na virada do mês, com orquestração segura via endpoint `/api/cron` autenticado.
- **Filtros & Paginação de Alta Performance**: Visualização de escalas e folhas de ponto com paginação padrão (10 itens por página), busca textual e filtros refinados de Mês, Ano e Status (Previsão / Fechada, Status Escala, Status Folha).
- **Multi-categoria**: Suporte nativo para turnos **Regulares**, **Extras**, **Plantões** e **Sobreaviso**.
- **Templates Dinâmicos**: Aplicação rápida de padrões de escala (**12x36**, **5x2**, **6x1**) com um clique.
- **Detecção de Conflitos**: Motor de validação global que impede que um servidor seja escalado em dois locais ao mesmo tempo.
- **Horas Extras Virtuais**: Lançamento de horas extras numéricas (1h, 2h, etc.) sem geração de falsos positivos de conflito com a escala regular do servidor (como o turno normal MT).
- **Validação de Governança**: Restrição rígida por linha na grade de escala (Extra apenas na linha EXTRAS, Sobreaviso na linha SOBREAVISO) e bloqueio automático de horas extras diárias acima do limite legal de 2 horas.
- **Visualização Hierárquica de Setores**: Dropdowns de seleção de setores organizados em formato de árvore (ex: indentação de subsetores como a Enfermagem sob sua respectiva Ala), eliminando ambiguidades e facilitando a navegação.
- **Impressão de Escalas Otimizada**: Componente `ScalePrintView` integrado no portal de consulta para exportação direta em PDF e impressão das escalas mensais organizadas por unidade/setor, em conformidade com as exigências municipais.

### 📅 Gestão de Afastamentos & Eventos
- **Administração de Ausências**: Painel dedicado para cadastro de Férias, Atestados Médicos, Licenças Maternidade/Paternidade e Prêmio.
- **Sincronização com o Grid**: Regra automática que limpa turnos diários planejados concorrentes (sem presença confirmada) no período do evento, impedindo a alocação indevida de servidores afastados.
- **Exclusão Restrita**: Remoção de afastamento cadastrado indevidamente, disponível para Administrador Geral, RH Geral e RH da Unidade.

### ⚖️ Compliance Legal (Motor de Regras)
- **Validação de Interjornada**: Alerta automático para períodos de descanso inferiores a 11 horas.
- **Validação de DSR**: Controle de Descanso Semanal Remunerado (7+ dias de trabalho).
- **Segurança Jurídica**: Alertas visuais preventivos para o coordenador antes do fechamento da folha.

### 📊 Painel de Auditoria & Relatórios Diagnósticos
- **Comparativo Histórico em Tempo Real**: Gráfico no Painel de Controle com acompanhamento em tempo real das horas do mês vigente sem necessidade de fechamento formal da escala, escala vertical (Eixo Y), grade visual e cartões interativos de detalhamento por mês.
- **Relatórios Consolidados**: Relatórios de frequência de ponto, consolidados de horas extras, relatórios gerenciais de distribuição e conciliação por setores.
- **Dashboard de Performance**: Painel estatístico com gráficos dinâmicos de plantões extras e taxas de acionamento/resposta de sobreavisos por período, facilitando decisões de dimensionamento de pessoal pelo RH.
- **Filtros Modulares**: Sistema integrado de busca e refinamento por data, servidor, cargo, unidade e setor em todo o módulo de relatórios.

### 🔄 Portal do Servidor & Consulta de Escala (`ConsultarEscalaClient`)
- **Consulta Autenticada via PIN**: O servidor acessa sua escala individual e espelho de folha de ponto utilizando sua Matrícula/CPF e PIN individual de segurança.
- **Solicitação de Trocas de Plantão**: Fluxo interativo no portal para pedido de substituição/permuta com validação em tempo real e encaminhamento para aprovação da coordenação.
- **Notificações**: Status de solicitações (Aprovado/Rejeitado) visíveis instantaneamente no painel do servidor.

### 🕒 Controle de Presença (Ponto Digital)
- **Check-in/Check-out**: Registro de entrada e saída via PIN com geolocalização (GPS).
- **Frequência Inteligente para Horas Extras**: Registro unificado de check-in e check-out que calcula dinamicamente o fim do expediente somando a jornada regular do dia com as horas extras lançadas, gravando a presença em ambos os lançamentos (Regular e Extra) em uma única batida de ponto no terminal.
- **Janela de Tolerância**: Bloqueio de batidas fora do horário permitido para evitar fraudes.
- **Auditoria Forense**: Trilha de auditoria detalhada para todas as batidas e ajustes manuais.
- **Geolocalização em Setores com Fallback**: Configuração opcional de coordenadas geográficas (`latitude`, `longitude` e `raio_geofence`) específicas para setores físicos descentralizados. Quando não preenchida, o sistema herda automaticamente a geolocalização da unidade principal.
- **Faltas Automáticas na Folha de Ponto (v2.0.0)**: Dia com turno previsto e nenhuma marcação (real ou manual) de entrada/saída vira pendência de justificativa e, se ninguém regularizar dentro do prazo configurável, falta definitiva — sem depender de alguém digitar "FALTA" na observação.

### 🕐 Relógio de Ponto Físico (REP)
- **Integração com Equipamento REP-C Certificado**: Coleta de AFD assinado (Portaria 671/2021) por sincronização online contínua ou por coletor local instalado na unidade.
- **Coleta e Cadastro por Pendrive (v2.0.0)**: Para unidades sem rede até o relógio — exportação/importação de marcações e, agora, de cadastro de identidade (`coletor-rep-cli cadastros-exportar`), no mesmo formato CSV que o próprio equipamento usa para importar por USB.
- **Higiene de Cadastros do Dispositivo**: Leitura de tudo que está cadastrado no relógio, com remoção segura (confirmada por relistagem) de quem sobrou de sistema anterior e não corresponde a nenhum servidor ativo.
- **Cobertura da Escala**: Painel que cruza quem está escalado com quem realmente consegue bater ponto no equipamento — identifica o caso silencioso de servidor cadastrado e com biometria, mas sem vínculo no SisEscala, cuja batida vira órfã sem ninguém perceber.
- **App de Bandeja para a Unidade**: Aplicativo local (`.exe`, auto-instalável, sem privilégio de administrador) que mantém o ciclo de sincronização rodando na máquina da unidade, com aviso de atualização disponível.

### ✈️ Gestão de Diárias e Pernoites (Planejado)
- **Deslocamento a Serviço**: Módulo desenhado para controle orçamentário e logístico de servidores que viajam com frequência (motoristas, TI, campanhas de saúde externa).
- **Cálculo Automático**: Aplicação de tabelas de reembolso diferenciadas por tipo de destino (Zona Rural, Vilas, Intermunicipal, Capital) e nível do cargo, com distinção entre diárias cheias (pernoite) e meia-diárias.
- **Prestação de Contas Integrada**: Fluxo de aprovação prévia com anexação posterior de relatórios e comprovantes diretamente no sistema.

## 🛠️ Stack Tecnológica


- **Frontend**: [Next.js 15+](https://nextjs.org/) (App Router)
- **Linguagem**: [TypeScript](https://www.typescriptlang.org/)
- **Estilização**: [Tailwind CSS](https://tailwindcss.com/)
- **Ícones**: [Lucide React](https://lucide.dev/)
- **Backend/Banco de Dados**: [Supabase](https://supabase.com/) (PostgreSQL + RLS + Auth), self-hospedado
- **Deployment**: [Coolify](https://coolify.io/) numa VPS própria — deploy automático a cada push na `main`

---

## 📦 Instalação e Configuração

### Pré-requisitos
- Node.js 20+
- Conta no Supabase

### Passo a Passo

1. **Clonar o repositório**
   ```bash
   git clone https://github.com/fmarculino/SisEscala.git
   cd SisEscala
   ```

2. **Instalar dependências**
   ```bash
   npm install
   ```

3. **Configurar Variáveis de Ambiente**
   Crie um arquivo `.env.local` na raiz e adicione suas chaves do Supabase:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=sua_url_aqui
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_key_anon_aqui
   SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key_aqui
   ```

4. **Configurar o Banco de Dados**
   O projeto utiliza migrações SQL localizadas na pasta `/supabase`. Execute o schema inicial no seu painel SQL do Supabase.

5. **Executar em modo de desenvolvimento**
   ```bash
   npm run dev
   ```

---

## 🏛️ Estrutura de Governança (RBAC)

O SisEscala utiliza uma hierarquia de acesso rigorosa via **Row Level Security (RLS)**:

- **Administrador Geral (`super_admin`)**: acesso total ao sistema, configurações estruturais e gestão de usuários — inclusive a criação de outros Administradores Gerais e a exclusão definitiva de contas, que não são delegadas a ninguém.
- **RH Geral (`rh`)**: enxerga a secretaria inteira e administra usuários de todas as unidades, **exceto** os de perfil Administrador Geral.
- **RH da Unidade (`rh_unidade`)**: mesmo alcance operacional do RH Geral, restrito às unidades vinculadas ao perfil (com acesso a todos os setores delas). Administra somente usuários cujo escopo cabe inteiro dentro dessas unidades.
- **Diretor (`admin`)**: gerencia unidades e setores específicos vinculados ao seu perfil.
- **Coordenador (`coordenador`) e Ass. Administrativo (`ass_adm`)**: elaboram escalas, aprovam trocas e validam a presença dos servidores dentro do escopo vinculado.
- **Servidor (`servidor` / `comum`)**: acesso restrito ao Portal do Servidor para consulta e solicitações de troca.

---

## 📦 Versionamento e Ciclo de Releases

A partir do lançamento da versão **V1.0.0**, o SisEscala adota uma política estrita de versionamento semântico para ambientes de produção e homologação:
- **Versão Estável**: Indicada por `vX.Y.Z` (ex: `v1.0.0`, `v1.1.0`). Considerada pronta e testada para uso real em produção.
- **Ciclo de Homologação (RC)**: Modificações, melhorias e correções incrementais passarão por homologação usando sufixos `RC` (Release Candidate) antes de serem consolidadas como estáveis (ex: `v1.0.1RC`, `v1.0.1RC-1`, `v1.0.1RC-2`).
- **Nomenclatura**: A designação `Beta` deixa de ser utilizada no escopo de produção.

---

## 📄 Licença

Este projeto é privado e de uso exclusivo da **Secretaria Municipal de Saúde de Marabá (DMAC)**. Todos os direitos reservados.

---
**Desenvolvido por:** [Fernando Marculino](https://github.com/fmarculino) & Antigravity AI.
