# Coordenador em Pendências de Cadastro + atualizar cadastro existente via RH — 12/08/2026

## Contexto

Olhando a tela de "Importados aguardando cadastro" (v1.42.0), o usuário notou duas coisas ao
mesmo tempo: só admin/super_admin conseguiam chegar nela (a intenção original da importação de
RH era justamente facilitar a inclusão de servidores, e só quem já tinha acesso admin conseguia
usar isso), e quando o CPF do vínculo importado batia com um servidor já cadastrado, a única
saída era "confirmar vínculo adicional" — que sempre cria um cadastro **novo**. Não existia
"isto é atualização de um cadastro que já existe", que na prática é o caso mais comum (RH
reimporta alguém que já está no SisEscala, trazendo dado complementar que falta).

## Decisões confirmadas com o usuário antes de mexer

1. **Coordenador vê uma versão limitada da tela de Pendências** — só a importação de RH, da
   própria unidade. As duas seções que enxergam a base inteira sem escopo (documentos com
   dígito inválido, duplicidades suspeitas) continuam admin/super_admin apenas: são
   `SECURITY DEFINER` de propósito pra pegar duplicata entre unidades, e abrir isso pra
   coordenador vazaria CPF/nome de servidor de outras unidades.
2. **"Atualizar cadastro" só preenche o que está vazio** (`COALESCE`) — nunca sobrescreve campo
   já preenchido, protegendo correção manual feita antes.
3. **"Atualizar cadastro" nunca mexe em unidade/setor/matrícula/status** — mudar lotação
   continua exigindo o fluxo de solicitação com aprovação do Administrador Geral (v1.43.0,
   criado depois do incidente real da THIELE/KETTELE, onde duas transferências erradas
   passaram batendo direto na tabela). Divergência de lotação vira só um aviso na tela.

## O que mudou

**Sidebar** (`src/components/layout/sidebar.tsx`) — `isCoord` escondia o grupo `CADASTROS`
inteiro. Virou filtro por item: coordenador/ass_adm agora veem "Servidores" e "Pendências de
Cadastro" dentro desse grupo, o resto continua escondido. "Servidores" não precisou de nenhuma
mudança de backend — a RLS `"Scoped access for Admins and Coordinators"` (`20260618080000`) já
incluía `coordenador` explicitamente, escopado por `profile_unidades`/`profile_setores`; só
faltava o link no menu.

**`/servidores/pendencias/page.tsx`** — mesma rota, conteúdo por papel. admin/super_admin
continuam vendo as 5 seções de sempre, sem mudança. coordenador/ass_adm pulam as consultas
cross-unit inteiramente e recebem só a lista de `importacao_rh_pendentes` (nova policy de RLS,
escopada por `profile_unidades`).

**Painel de conflito de CPF** (`ImportacaoRhSection.tsx`) — antes, o conflito só aparecia depois
de tentar salvar e receber um erro do banco, com uma checkbox "confirmo que é vínculo adicional"
escondida dentro da mensagem vermelha. Agora, `buscarConflitoCpf` (nova action, chama
`fn_cpf_ja_cadastrado` já existente) roda assim que a linha é aberta, e mostra duas opções
explícitas lado a lado:
- **Atualização do cadastro existente** — novo, chama `fn_atualizar_cadastro_via_pendencia_rh`.
- **Vínculo adicional de verdade** — o fluxo de sempre, cria cadastro novo.

Se a unidade do RH divergir da lotação atual do cadastro existente, isso aparece como aviso de
texto embaixo da opção de atualização — nunca altera nada sozinho.

**`fn_atualizar_cadastro_via_pendencia_rh`** (migration `20260812020000`) — redriva o conflito
de CPF no servidor (nunca confia cegamente no `servidor_id` que o cliente manda), checa escopo
via `fn_unidade_no_escopo`, e faz `UPDATE ... SET campo = COALESCE(campo, novo_valor)` pros
mesmos campos complementares que `fn_promover_pendencia_rh` já grava na criação — excluindo
explicitamente matrícula/unidade/setor/status. A action correspondente em `actions.ts` calcula o
diff real (`calcularAlteracoes`) e registra em auditoria como `SERVIDOR_EDITADO`.

**`fn_promover_pendencia_rh` ganhou checagem de escopo** — até aqui não validava papel nenhum,
porque só era alcançável pela UI admin-only. Como coordenador passa a chamar direto, acrescentou
`fn_unidade_no_escopo(p_unidade_id)`: admin/super_admin sempre passam, coordenador/ass_adm só
promovem pra dentro da própria unidade. Mudança aditiva — resto da função idêntico ao de
`20260811160000` (copiado por completo, `CREATE OR REPLACE` troca o corpo inteiro).

## Pendente do lado do usuário

Migration `20260812020000` precisa ser aplicada em homologação e depois em produção — não temos
acesso de escrita ao banco de produção.
