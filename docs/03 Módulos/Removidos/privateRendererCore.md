---
tipo: módulo
status: removido
removido-em: 2026-11-07
arquivo: src/integration/host/privateRendererCore.js
camada: integração
testes: test/integration/host/privateRendererCore.test.js
tags: [módulo]
---

# privateRendererCore

> [!note] Removido em 2026-11-07
> O host da cópia privada saiu inteiro. Ver [[ADR-028 Modo antigo removido]]. O código está na tag `modo-antigo-final` (`git checkout modo-antigo-final -- <caminho>`). Esta nota fica só como histórico.

> Adapta o `renderer.js` da versão 142 do Riot para que a tela de login reconheça um desafio de MFA que já existe, em vez de reiniciar a autenticação.

## Responsabilidade

Na preparação da cópia privada, reescreve dois trechos do hook `useLoginForm` do renderer 142. Na inicialização do formulário, consulta o contexto de autenticação atual e, se houver MFA pendente, mostra a etapa de MFA certa. Também reage quando a assinatura de autenticação muda para MFA. Na 141 não muda nada. Não cria componentes nem tratadores de MFA próprios.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `hardenPrivateRendererSource(source, { version })` | função | `141.0.0`: devolve o texto igual. `142.0.0`: aplica o adaptador. Outra versão: erro. Idempotente. |
| `PRIVATE_RENDERER_MFA_MARKER` | constante | `RAM_PRIVATE_RENDERER_MFA_CONTEXT_V1`. |

## Dependências

- Usa: nenhuma.
- Usado por: [[Scripts de integração]] (`prepare-private-riot-host.js`), [[privateHostCore]] (confere o marcador).

## Invariantes e decisões

- **Nada nativo é trocado.** Os componentes de MFA e os tratadores de conclusão do Riot ficam intactos. O adaptador só fornece a etapa e o e-mail que o próprio tratador de envio nativo definiria ao receber a mesma resposta de autenticação.
- **O que o marcador prova.** `RAM_PRIVATE_RENDERER_MFA_CONTEXT_V1` dentro de `ramPrivateHydrateMfa142` mostra que o adaptador foi aplicado. [[privateHostCore]] exige o marcador no renderer do candidato na 142, junto com `behavior.externalMultifactorRecovery` no manifesto.
- **Âncoras do bundle 142.** Todas precisam aparecer exatamente uma vez:
  - `HOOK_START`: `useLoginForm=({error:Ge,setErrorState:Ke,setLoginFormStage:Qe,setMfaEmail:Ze,rememberMe:Je,setRememberMe:tt})=>{`
  - `HOOK_END`: `;function generateQuery(`
  - `AUTH_SUBSCRIPTION`: `ca=useXboxAuthenticator(),`
  - `ORIGINAL_INITIALIZE`: `Il=async()=>{if(Mt(""),Bt(!1),zt(!0),!await bl())return ol();`
  - `ORIGINAL_EFFECTS`: `return reactExports$1.useEffect(()=>{zn(Ht)},[Ht]),`
- **Âncoras dentro do hook.** `AUTH_SUBSCRIPTION`, `ORIGINAL_INITIALIZE` e `ORIGINAL_EFFECTS` precisam ficar entre `HOOK_START` e `HOOK_END`.
- **Inicialização nova.** Antes do fluxo original, lê `RSO_AUTHENTICATOR_ENDPOINT$2` via `getBinding().get(..., { skipCache: true })`. Com `type: 'multifactor'`, hidrata a etapa e retorna sem rodar o fluxo original; se o método não for reconhecido, só chama `Bt(!1),zt(!1)` e retorna. Se a leitura falhar com status diferente de 404, chama `Bt(!1),zt(!1)` e retorna, preservando a autenticação. Com 404 ou sem MFA, segue o fluxo original.
- **Efeito novo.** Um `useEffect` sobre `ca` (o valor de `useXboxAuthenticator()`) hidrata MFA concluído fora do tratador de envio nativo.
- **Hidratação restrita.** Não faz nada se `vt.current` for verdadeiro. Métodos aceitos: `thirdparty`, `riotmobile` e `email`, que viram `mfa_thirdparty`, `mfa_riotmobile` e `mfa_email`. Outro método é ignorado, sem etapa não suportada.
- **E-mail validado.** Só passa para `Ze` (o `setMfaEmail`) se for string de até 320 caracteres sem caracteres de controle. Senão passa `null`. O valor vai para o estado do React, nunca é interpretado como marcação.
- **Idempotência.** Se o marcador já existe, exige marcador, inicialização nova e efeito novo únicos e nenhum trecho original. `ramPrivateHydrateMfa142` sem marcador é "inconsistente".
- **Checagem de sintaxe só do hook.** O bundle é um módulo ES e contém `import.meta` em outros pontos. Por isso só o trecho do hook alterado é compilado com `new Function`, como atribuição isolada e sem executar.

## Testes

`privateRendererCore.test.js` roda o hook adaptado num `vm` com um bundle de mentira. Nele, `Mt`, `Bt`, `zt` e `bl` são modelados como limpar senha, `setLoggingIn`, `setLoading` e um DELETE do contexto. Cobre: limite de versão, âncoras únicas e idempotência; MFA existente hidratado sem apagar nem reiniciar o contexto, para os três métodos; MFA vindo da assinatura; login normal mantém o fluxo original; MFA desconhecido preservado; e-mail restrito; falha de leitura preserva a autenticação e 404 usa o fluxo nativo.

## Pontos de atenção

- As âncoras usam nomes minificados. Qualquer novo build do Riot pode quebrá-las; a preparação falha fechada. Ver [[Atualização do Riot Client]].
- O código injetado também usa `vt`, `Bt`, `zt`, `Qe`, `Ze`, `getBinding` e `RSO_AUTHENTICATOR_ENDPOINT$2`, que não são âncoras. `new Function` só verifica sintaxe. Se um desses nomes mudar, o erro só aparece em tempo de execução.
- Não há adaptador para a 141. Ver [[Limitações conhecidas]].
