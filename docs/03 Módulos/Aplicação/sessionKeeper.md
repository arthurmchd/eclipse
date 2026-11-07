---
tipo: módulo
arquivo: src/core/sessionKeeper.js
camada: aplicação
testes: test/core/sessionKeeper.test.js
tags: [módulo]
---

# sessionKeeper

> Guarda no cofre do Eclipse cada sessão que a Riot grava e tira o login lembrado do arquivo da Riot assim que ela solta a conta, para a Riot sempre abrir desconectada, na tela de login com os cartões.

## Responsabilidade

Com "Manter login" ligado, a Riot grava o login lembrado no `RiotGamesPrivateSettings.yaml`. Ao abrir, ela restaura a conta a partir desse arquivo. Este módulo:

1. percebe cada gravação (aviso do Windows) e, a cada 4 s, confere o arquivo quando a Riot está fechada ou sem conta conectada;
2. descobre de qual conta é o login, pelo `sub` (ou, sem sessão guardada com ele, pelo Riot ID gravado pela Riot);
3. guarda o YAML na sessão dessa conta ([[store]]) sempre que ele mudou, com a Riot aberta ou não;
4. se a Riot não está segurando uma conta conectada (fechada, em segundo plano ou na tela de login), grava de volta o arquivo sem o login (`stripPersistedLogin`, mantém o `tdid`), seja a conta do Eclipse ou não;
5. pede à Riot a saída normal quando ela está conectada e um jogo fechou, ou quando ficou sem janela e sem jogo;
6. se a Riot fechada assim estava com a janela aberta, inicia de novo a Riot, desconectada, na tela de login, depois que ela saiu e o arquivo foi limpo;
7. apaga na hora a sessão guardada de uma conta que saiu pela Riot (ou pelo "Sign Out" do League), para o próximo Jogar dela ir direto ao login visível;
8. ao iniciar, apaga as sessões guardadas antes do modo cartões atual, que provavelmente já não valem.

Assim a Riot abre desconectada, e Jogar restaura a sessão em segundo plano ([[signInFlow]]). O usuário nunca precisa sair da conta pela Riot.

**Não faz:**

- não roda com login em andamento;
- não roda com "Manter login" desligado;
- não limpa o arquivo com a Riot conectada (a conta está na memória dela, e o jogo depende disso);
- não encerra a Riot na tela de login, nem com a janela dela aberta antes de um jogo;
- não sai da conta (`DELETE`) nem derruba processo à força;
- não inicia a Riot fora da reabertura acima, nem mexe numa Riot que já esteja rodando;
- não restaura sessão nenhuma.

Decisões em [[ADR-019 Sessão salva por conta no modo cartões]], [[ADR-020 Riot conectada é encerrada quando fica sem jogo]], [[ADR-021 Riot sempre abre desconectada]], [[ADR-022 Sessões de antes do modo cartões são descartadas]] , [[ADR-026 Riot fechada depois do jogo reabre na tela de login]] e [[ADR-027 Saída da conta pela Riot apaga a sessão guardada]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createSessionKeeper(options)` | função | Devolve `{ start, check, keep, stop }`. |
| `start()` | função | Apaga as sessões de antes do modo cartões, começa a observar o arquivo da Riot, agenda uma conferência (pega o que ficou de quando o Eclipse estava fechado) e liga a olhada nos processos. |
| `check()` | função | Agenda uma conferência daqui a `delayMs`. Chamadas seguidas adiam a mesma conferência. |
| `keep(yaml)` | função | Guarda na conta dona o login lembrado em `yaml`, se a dona for provada. Devolve a conta ou `null`. Não olha `busy()`: o [[main]] usa durante um login para guardar a sessão de quem sai. Também apaga a anotação da conta segurada pela Riot, porque vem de um fechamento. |
| `stop()` | função | Fecha o watcher e cancela a conferência e a olhada pendentes. Depois disso nada mais roda. |

**`options`:**

- `riot`: o [[riotClient]], com `watchSettings`, `look`, `quitClient`, `startClient`, `readSettingsYaml`, `writeSettingsYaml`, `hasPersistedLogin`, `stripPersistedLogin`, `persistedSubject`, `persistedRiotId` e `sameRiotId`.
- `store`: o [[store]], com `data.accounts`, `data.settings.staySignedIn`, `data.settings.riotClientPath`, `hasSession`, `loadSession`, `saveSession`, `sessionSavedAt` e `forgetSession`.
- `busy`: diz se há login em andamento.
- `log`: grava no `sign-in.log`.
- `onSaved(account)`: avisa que a sessão de uma conta foi guardada ou apagada, para o cartão atualizar o ⚡.
- `setTimeout` e `clearTimeout`: injetáveis nos testes.
- `delayMs`: padrão 1000.
- `pollMs`: padrão 4000. Zero desliga a olhada nos processos.
- `keptSince`: padrão 2026-11-06 13:00 UTC. Sessões gravadas antes disso são apagadas no `start()`.
- `reopenPolls`: padrão 5. Quantas olhadas a reabertura espera a Riot sair e o arquivo ficar limpo.

## Dependências

- Usa: [[riotClient]], [[store]].
- Usado por: [[main]].

## Invariantes e decisões

- **Estado da Riot pelo [[riotState]].** Desde 2026-11-07 ([[ADR-029 Estado da Riot definido num lugar só]]), cada conferência, cada olhada nos processos e cada confirmação de saída pede uma olhada nova com `riot.look()`. Antes o guardião combinava `clientRunning`, `runningGames`, `isAuthorized` e `authorization` do seu jeito. Com a Riot real as respostas são as mesmas. Nos testes, `clientRunning` e `isAuthorized` falsos saíram: a Riot falsa responde só pela lista de processos e por `authorization`, passando pela regra real.

- **A Riot restaura a conta a partir do arquivo.** Conferido no log da Riot v142 em 2026-11-06 ([[ADR-021 Riot sempre abre desconectada]]): quando o jogo fecha, a Riot não sai. Ela passa ao modo segundo plano ("Running in background is enabled, so not quitting") e descarta a conta da memória, com `RiotClientServices` ainda rodando. Ao ser aberta de novo, restaura a conta a partir do login lembrado no arquivo ("PSL state changed to RestoreAuthorization"). Por isso o arquivo precisa estar limpo sempre que a Riot não está usando a conta, não só quando ela sai.
- **Guarda toda versão nova; limpa quando a Riot solta a conta.**
  - O `refresh_token` é de uso único: cada restauração o troca, e a cópia antiga deixa de valer. Por isso cada versão do login de uma conta conhecida é guardada na hora, com a Riot aberta ou não. Uma versão igual à guardada não é regravada.
  - Depois de guardar, a conferência pergunta numa olhada do [[riotState]] se a Riot está conectada (`signedIn()`: aberta e com conta `'yes'`). Só com ela conectada o arquivo fica: a conta está na memória e limpar não mudaria a tela. Fechada, em segundo plano ou na tela de login, o arquivo é limpo.
  - Até 2026-11-06, a limpeza esperava a Riot sair, com repetições a cada 2 s. No modo segundo plano ela nunca sai, e a Riot abria conectada. As repetições foram removidas.
- **Vale para qualquer conta.** Um login lembrado sem dona comprovada (conta fora do Eclipse, duas contas com o mesmo Riot ID ou `id_token` ilegível) também é limpo, sem ser guardado. O log registra "cleared a remembered Riot login that is not from an account in Eclipse". Pedido do usuário: a Riot deve abrir sempre desconectada de qualquer conta.
- **Nada sobrescreve uma gravação mais nova.** A limpeza passa a versão lida como `expected` para `writeSettingsYaml`, que relê o arquivo logo antes de trocá-lo. Se a Riot o regravou durante a conferência, nada é escrito e nada vai ao log. A mudança gera outra conferência, que guarda a versão nova e limpa. Desde 2026-11-06, a troca é atômica ([[riotClient]]); antes, a releitura vinha antes de uma gravação direta.
- **A olhada nos processos também limpa.**
  - A cada 4 s, uma olhada do [[riotState]] diz se há jogo, Riot ou janela da Riot. A mesma olhada responde depois se a Riot está conectada, sem nova lista de processos.
  - **Com jogo aberto,** nada é feito: a Riot segura a conta.
  - **Com a janela da Riot aberta, nenhum jogo visto e nenhum login no arquivo,** nada é feito. A API local só é consultada se houver uma conta anotada como segurada pela Riot (abaixo).
  - **Com a Riot fechada ou desconectada,** se o arquivo tem login, agenda uma conferência. Isso cobre o modo segundo plano sem nova gravação e um aviso do Windows que falhou.
  - **Com a Riot conectada sem jogo,** se um jogo fechou ou ela não tem janela, a condição precisa aparecer em duas olhadas seguidas. Aí vem `quitClient()`, a saída normal (`POST /process-control/v1/process/quit`). A Riot grava o login ao sair, e a conferência seguinte guarda e limpa.
  - `busy()` e "Manter login" são conferidos antes e depois de cada consulta à Riot, porque ela leva tempo. Um erro numa olhada zera a contagem, e a próxima acontece normalmente.
- **A Riot fechada com a janela aberta volta na tela de login.** Desde 2026-11-06 ([[ADR-026 Riot fechada depois do jogo reabre na tela de login]]), relato do usuário: ele abriu a Riot pela bandeja enquanto o League fechava, viu a conta conectada e a Riot sumiu sozinha segundos depois.
  - Ao pedir a saída, o guardião marca uma reabertura só se `clientWindow` estava ligado. Na prática, só depois de um jogo: antes de um jogo, uma Riot com janela nunca é encerrada.
  - Nas olhadas seguintes (até `reopenPolls`), espera nenhum processo da Riot e nenhum login lembrado no arquivo. Com login no arquivo, a olhada só agenda a conferência, que guarda e limpa.
  - Aí chama `startClient` com o caminho das Configurações, que só inicia uma Riot totalmente fechada. Se ela já está rodando, nada acontece ([[riotClient]]).
  - Login em andamento, "Manter login" desligado, `stop()` ou um jogo cancelam a reabertura. `busy()` é conferido de novo logo antes de iniciar.
  - Uma falha ao iniciar vira "could not reopen the Riot after closing it", sem a mensagem, e não é repetida. Esgotadas as olhadas, o log registra "gave up reopening the Riot after closing it".
- **Saída pela Riot apaga a sessão guardada.** Desde 2026-11-07 ([[ADR-027 Saída da conta pela Riot apaga a sessão guardada]]). No log da Riot v142, a saída manual regrava na hora o login lembrado no arquivo e volta à tela de login com o processo aberto. O fim do jogo em segundo plano solta a conta sem regravar o arquivo.
  - Quando a conferência acha o login de uma conta do Eclipse com a Riot conectada, o guardião anota a conta e a versão guardada.
  - Se depois o arquivo aparece sem login, ele confirma numa olhada nova que a Riot roda e que a conta é `'no'`, relê o arquivo e confere que a sessão guardada ainda é a versão anotada. Aí apaga a sessão (`forgetSession`), avisa o cartão (`onSaved`) e registra "forgot the saved session of an account signed out in Riot".
  - A conferência faz isso a cada mudança no arquivo, e a olhada nos processos faz de novo a cada 4 s. Com a resposta `'unknown'`, a anotação fica para a próxima vez.
  - A anotação some num login em andamento, num `keep()` vindo de fechamento, quando o guardião limpa o arquivo, quando a Riot fecha, com "Manter login" desligado, com a resposta `'yes'` (outra conta conectada sem login no arquivo) e depois de cada decisão. Sem anotação, nada é apagado.
  - O guardião não fecha nem reabre a Riot por isso.
- **A dona é provada pelo `sub`, com o Riot ID como segunda prova.**
  - Primeiro, a conta cuja sessão já guardada tem o mesmo `sub` (`persistedSubject`, que lê o `id_token` ou o cookie antigo).
  - Sem essa sessão, a conta cujo Riot ID bate com o do `id_token` (`persistedRiotId` e `sameRiotId`), desde que seja uma só. Duas contas com o mesmo Riot ID não provam nada.
  - O `sub` ganha do Riot ID: um Riot ID trocado depois do login não leva a sessão para outra conta.
  - No primeiro teste real (2026-11-06), a Riot não gravou o cookie `sub`. Desde então a identidade vem do `id_token` ([[ADR-019 Sessão salva por conta no modo cartões]]).
- **`keep()` é a mesma identificação para quem sai.** O [[main]] chama `keep()` no `onClosed` de um login, com o YAML que a Riot gravou ao fechar. Assim a sessão de quem sai vai para a conta certa, mesmo que não seja a última usada pelo Eclipse. `keep()` não olha `busy()`, mas respeita `stop()` e "Manter login".
- **Guarda antes de limpar.** `saveSession` vem antes de `writeSettingsYaml`. Se guardar falhar, o arquivo da Riot não é tocado. O log registra "could not keep the Riot session" uma vez, sem a mensagem do erro (que pode trazer caminhos), e só volta a registrar depois de uma conferência bem-sucedida.
- **Não disputa com o login.**
  - Durante um login, o [[signInFlow]] fecha a Riot e escreve o YAML da conta escolhida. O guardião não pode limpar esse arquivo nem encerrar a Riot no meio do caminho.
  - O [[main]] pede uma conferência quando cada operação termina, para pegar o que a Riot gravou durante o login.
- **Uma conferência por vez.** Uma mudança durante uma conferência marca "de novo" e roda mais uma depois, em vez de rodar em paralelo. A conferência roda 1 s depois da última mudança no arquivo, tempo para a Riot terminar de escrever.
- **Sessões antigas são apagadas ao iniciar.**
  - Uma sessão gravada antes de `keptSince` (data do arquivo, `store.sessionSavedAt`) é apagada no `start()`, com "Manter login" ligado ou não, e o cartão é avisado (`onSaved`).
  - Essas sessões vêm de fluxos que saíam da conta na troca e não acompanhavam a troca de tokens. Tentar uma delas fechava a Riot, esperava 15 s pela recusa e reabria a Riot para o login visível. Sem ela, o primeiro Jogar faz o login visível direto na Riot aberta.
  - Uma falha ao apagar uma sessão não impede as outras. O log registra só quantas foram apagadas ([[ADR-022 Sessões de antes do modo cartões são descartadas]]).
- **Startup confere uma vez.** Se o Eclipse estava fechado quando a Riot gravou o login, ele ainda está no arquivo. Na abertura do Eclipse, com a Riot fechada ou desconectada, o login é guardado e limpo.
- **Log sem dados da conta.** As linhas não levam nome, Riot ID, `sub` nem trechos do arquivo.

## Testes

`test/core/sessionKeeper.test.js`, com Riot, store e relógio falsos (a conferência e a olhada nos processos têm relógios separados), cobre:

- login guardado na conta do mesmo `sub` e limpo do arquivo da Riot;
- versão igual não regravada;
- login de conta fora do Eclipse limpo sem ser guardado, mas nunca com a Riot conectada;
- conta sem sessão guardada reconhecida pelo Riot ID só quando ele é único, e `sub` ganhando do Riot ID;
- arquivo sem login nunca reescrito;
- com a Riot conectada, cada sessão renovada guardada e o arquivo mantido; quando ela solta a conta, a olhada nos processos limpa o arquivo sem nova gravação;
- arquivo regravado durante a conferência nunca sobrescrito, e a versão nova guardada em seguida;
- login em andamento (antes e durante a conferência);
- "Manter login" desligado;
- mudança durante uma conferência;
- `stop`;
- falha ao guardar sem limpar o arquivo, sem vazar a mensagem e sem repetir no log;
- `keep()` durante um login;
- saída normal pedida depois de um jogo fechar, mesmo com a janela da Riot aberta;
- saída pedida para a Riot conectada sem janela e sem jogo, e nunca com a janela aberta antes de um jogo;
- Riot fechada depois do jogo com a janela aberta reaberta uma vez, só depois de sair e de o login ser guardado e limpo, com o caminho das Configurações;
- nenhuma reabertura para a Riot fechada sem janela, para a Riot que não sai (com desistência registrada uma vez) e quando a Riot já foi aberta de novo;
- reabertura cancelada por login em andamento (antes e durante a olhada), jogo ou "Manter login" desligado;
- falha ao reabrir registrada sem detalhes e sem nova tentativa;
- conta que sai pela Riot com a sessão guardada apagada uma vez, com aviso ao cartão, sem gravar no arquivo nem fechar a Riot;
- Riot que só solta a conta depois do jogo, com a sessão mantida mesmo quando o arquivo limpo é regravado;
- nenhuma sessão apagada com login em andamento, troca de conta (`keep`), Riot fechada, outra conta conectada, sessão guardada diferente da anotada, "Manter login" desligado ou login gravado pela Riot durante a confirmação;
- resposta desconhecida esperando a olhada seguinte, saída confirmada pela olhada quando o aviso do arquivo falha, saída depois de um jogo e Riot fechada apagando a anotação;
- nunca encerrar a Riot na tela de login, durante um login ou com um jogo abrindo de novo;
- erro numa olhada sem parar as seguintes;
- sessões de antes do modo cartões apagadas uma vez no `start()`, com aviso ao cartão, e falha ao apagar uma sem impedir as outras.

Fora dos testes: o `fs.watch` real, o modo segundo plano real da Riot e o `tasklist` real.

## Pontos de atenção

- **Durante um jogo, a Riot aberta mostra a conta conectada.** O jogo depende dessa sessão, e o Eclipse não desconecta. Quando o jogo fecha, a Riot solta a conta e o arquivo é limpo em poucos segundos.
- **Abrir a Riot no mesmo instante em que o jogo fecha** ainda pode restaurar a conta antes da conferência (até uns 5 s). Com a janela aberta, ela mostra a conta, fecha e volta sozinha desconectada, uns 5 a 10 s depois ([[ADR-026 Riot fechada depois do jogo reabre na tela de login]]).
- **Sair da conta pela própria Riot (ou "Sign Out" no LoL) encerra a sessão no servidor.** O guardião não tem como impedir. Desde [[ADR-027 Saída da conta pela Riot apaga a sessão guardada]], ele percebe a saída e apaga a sessão na hora. Se a percepção falhar (Riot fechada menos de 1 s depois, Eclipse fechado na hora da saída, resposta desconhecida até a Riot fechar), o próximo Jogar dessa conta ainda fecha a Riot, tem a sessão recusada e reabre a Riot no login visível, uma vez.
- **Com o Eclipse fechado, nada limpa o arquivo.** A Riot aberta antes do Eclipse (por exemplo, iniciando com o Windows) pode entrar sozinha na última conta. Na abertura, o Eclipse limpa o que ficou e, se a Riot estiver conectada sem jogo e sem janela, a encerra.
- **Não se sabe se a Riot volta a gravar o login depois de uma limpeza com ela conectada.** Por isso a limpeza nunca acontece com ela conectada. Uma falha de rede momentânea na consulta da conta (`'unknown'` no [[riotState]]) pode, raramente, fazer uma limpeza nesse estado; a sessão já estava guardada.
- **Formato do `id_token`.** A identidade depende de a Riot continuar gravando o `id_token` com `sub` e `acct` no login lembrado. Se o formato mudar, o login deixa de ser guardado pelo guardião, mas continua sendo limpo. A sessão capturada pelo próprio login ([[signInFlow]]) não depende disso.
- **Custo.**
  - A olhada roda `tasklist` e lê o arquivo da Riot a cada 4 s enquanto o Eclipse está aberto.
  - A API local só é consultada com a Riot aberta, sem jogo e com login no arquivo ou com um jogo recém-fechado.
  - Cada conferência com login no arquivo decifra as sessões guardadas para comparar o `sub`. O `safeStorage` é local e rápido.
