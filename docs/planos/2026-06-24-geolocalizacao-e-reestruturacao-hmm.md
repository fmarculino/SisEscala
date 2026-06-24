# Estudo e Plano: Geolocalização Descentralizada e Reestruturação Organizacional (v1.7.0)

Este documento registra o estudo de impacto, a especificação técnica e as decisões arquiteturais adotadas no SisEscala v1.7.0 para suportar geolocalização por setores, migração estrutural de unidades e visualização hierárquica em dropdowns.

---

## 1. Estudo de Impacto: Geolocalização Descentralizada

### 1.1 Contexto e Problema
Originalmente, a geolocalização (`latitude`, `longitude`, `raio_geofence`) era vinculada estritamente às **Unidades** (ex: *SMS - Secretaria Municipal de Saúde*). Contudo, descobriu-se que alguns setores de uma mesma unidade administrativa operam em instalações físicas geograficamente distantes (ex: *CAF*, *Almoxarifado*, *Tecnologia da Informação* estão localizados fisicamente fora do prédio da administração da SMS).

Sob o modelo anterior, servidores escalados nesses setores remotos não conseguiam confirmar sua presença ou chegada de sobreaviso, pois suas batidas eram rejeitadas por estarem fora do raio de tolerância (geofence) da unidade cadastrada.

### 1.2 Solução Adotada (Geofence com Fallback)
Para manter a compatibilidade com a estrutura de dados existente e flexibilizar o controle, implementou-se o seguinte modelo:
1. **Atributos de Geolocalização nos Setores**: Adicionou-se as colunas `latitude`, `longitude` e `raio_geofence` à tabela `setores`.
2. **Fallback Automático (Herança)**: Ao validar a posição geográfica de uma batida de ponto ou chegada de sobreaviso, o sistema tenta primeiro ler as coordenadas do **Setor**. Se estas forem nulas (`NULL`), o sistema herda automaticamente as coordenadas da **Unidade** associada.
3. **Implementação SQL**:
   ```sql
   COALESCE(setores.latitude, unidades.latitude)
   COALESCE(setores.longitude, unidades.longitude)
   COALESCE(setores.raio_geofence, unidades.raio_geofence)
   ```
4. **Impacto**: Esta alteração é 100% retrocompatível. Setores que não exigem coordenadas específicas continuam funcionando herdando os valores da unidade.

---

## 2. Estudo de Caso: Migração de Unidade para Setor (ALA - PSICOSSOCIAL)

### 2.1 O Problema
A `"ALA - PSICOSSOCIAL"` foi erroneamente cadastrada como uma **Unidade** autônoma, quando conceitualmente é um **Setor** do `"HMM - Hospital Municipal de Marabá"`. Ela possuía o subsetor `"ENFERMAGEM"` (ID: `'225e432b-05b6-4a51-961d-1cf496464ac0'`), além de servidores cadastrados, escalas montadas e históricos de folhas de ponto.

Era necessário rebaixar a unidade para setor e mover suas estruturas para baixo do HMM sem quebrar links relacionais ou perder dados de auditoria.

### 2.2 Estratégia de Migração de Banco de Dados
A migração foi executada via script SQL transacional (`20260624010000_migrate_ala_to_hmm_sector.sql`) seguindo estes passos lógicos:
1. **Identificação dos IDs**: Localização e amarração de UUIDs para a Unidade HMM, Antiga Unidade ALA e o Dicionário de Setores correspondente.
2. **Criação do Setor Pai**: Criação do setor `"ALA - PSICOSSOCIAL"` sob a unidade do HMM.
3. **Reassociação do Subsetor**: Atualização da `unidade_id` e atribuição do `parent_id` do setor `"ENFERMAGEM"` da antiga ALA para apontar para o novo setor pai sob o HMM.
4. **Migração de Servidores e Lotações**: Atualização de todos os servidores que estavam alocados na antiga unidade para apontarem para a unidade HMM e seus respectivos setores.
5. **Migração de Escalas e Logs**: Ajuste das tabelas `escala_mensal` e logs de auditoria de sobreaviso para refletir a nova `unidade_id`.
6. **Remoção Segura**: Exclusão das referências antigas da tabela de setores e unidades que ficaram órfãs após a migração.

Como as chaves primárias dos servidores, escalas e subsetores foram mantidas, os históricos de folha de ponto (vinculados via `escala_mensal_id` e `servidor_id`) continuaram perfeitamente linkados e íntegros.

---

## 3. Resolução de Ambiguidade: Exibição Hierárquica em Dropdowns

### 3.1 O Problema
Após a reestruturação da `"ALA - PSICOSSOCIAL"`, o dropdown de setores da unidade `"HMM"` passou a conter dois setores chamados `"ENFERMAGEM"`:
1. O setor `"ENFERMAGEM"` padrão do hospital (ligado diretamente à unidade).
2. O setor `"ENFERMAGEM"` específico da `"ALA - PSICOSSOCIAL"`.

Em uma listagem plana de dropdowns comuns (`select`), o usuário visualizava duas opções idênticas de `"ENFERMAGEM"`, tornando impossível distinguir qual pertencia a qual local físico.

### 3.2 Implementação da Árvore Hierárquica
Criou-se o utilitário de formatação de setores no frontend ([sectors.ts](file:///c:/Users/SMS-NTI/Projetos/sisescala/src/utils/sectors.ts)):
* A função `formatSectorsHierarchy` recebe a lista de setores da unidade, resolve os vínculos recursivos de `parent_id` e gera uma lista ordenada em formato de árvore.
* Elementos filhos são deslocados com espaços não-quebráveis (`\u00A0\u00A0`) e recebem o prefixo `↳ `.
* Exemplo de renderização final:
  * `ENFERMAGEM`
    * `  ↳ CENTRO CIRÚRGICO`
    * `  ↳ PRONTO SOCORRO`
    * `  ↳ UTI ADULTO`
  * `ALA - PSICOSSOCIAL`
    * `  ↳ ENFERMAGEM`

Este formato foi aplicado a todos os seletores de setores nos módulos de **Folha de Ponto**, **Afastamentos**, **Nova Escala**, **Cadastro de Servidor** e **Filtros de Relatórios**.
