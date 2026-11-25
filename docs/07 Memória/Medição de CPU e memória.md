---
tipo: memória
categoria: projeto
criada: 2026-11-24
atualizada: 2026-11-24
tags: [memória, desempenho]
---

# Medição de CPU e memória

Em 2026-11-24 o agente mediu o Eclipse 2.28.4 instalado e entregou um relatório de otimizações de processador e memória. No mesmo dia o usuário pediu para aplicar as quatro primeiras, que saíram na 2.29.0 e foram medidas de novo. Os números abaixo são o ponto de partida para a próxima otimização.

**Por quê:** o usuário pediu "achar otimizações, seja para o processador ou memória", primeiro só como relatório, e depois "pode aplicar as 4 modificações que voce montou". Ele autorizou rodar o projeto para medir; nada foi feito na Riot real além de observar processos e conexões.

**Como aplicar:** antes de otimizar, partir destes números em vez de medir de novo; para comparar depois, medir nas mesmas condições (mesmo estado da janela da Riot, 60 s, o Eclipse aberto há alguns minutos). No primeiro minuto depois de abrir, a WebView2 da 2.29.0 gastou 6,3% de um núcleo; esse minuto não serve para comparar. As medições são passivas: tempo de CPU de cada processo no começo e no fim dos 60 s, a WebView2 contada pelos processos filhos do `eclipse.exe`, e o TIME_WAIT contado nas portas em que o serviço da Riot escuta em `127.0.0.1`, sem ler o lockfile e sem mostrar a porta. Sem captura de tela e sem pedido à API da Riot. O resto veio de um benchmark fora do repositório, com cópias do código e um servidor TLS local de teste no lugar da Riot.

## Antes e depois, no app instalado

Riot visível, na tela de login, com os cartões à vista. Duas rodadas de 60 s em cada versão.

| O quê | 2.28.4 | 2.29.0 |
|---|---|---|
| `eclipse.exe` | 1,4% a 1,7% de um núcleo, 19 MB privados | 0,62% de um núcleo, 16,9 MB privados |
| WebView2 | 9 processos, 288 MB privados, 0,1% a 0,26% de um núcleo | 8 processos, 258 MB privados, 0,1% de um núcleo |
| Processos de renderização | 3, com 97 MB | 2, com 65 MB |
| Conexões à API local em TIME_WAIT | cerca de 317 | 0, com uma conexão aberta e reaproveitada |
| Serviço da Riot (`RiotClientServices`) | 2,8% de um núcleo | 0,73% de um núcleo |

Na medição do relatório, com a Riot minimizada antes de o Eclipse abrir, a 2.28.4 tinha 0,23% de um núcleo e 11,8 MB no `eclipse.exe` e 221 MB em 8 processos da WebView2.

## No benchmark (por chamada)

| O quê | 2.28.4 | 2.29.0 |
|---|---|---|
| Certificado: abrir o `app.asar` (436 entradas) e ler o `root.pem` | 2,55 ms de CPU, 1,17 MB alocados em ~9.900 blocos | 0,03 ms, conferindo tamanho e data do arquivo |
| Pedido HTTPS local | 7,4 ms, 2,1 ms de CPU somando os dois lados, conexão nova | 0,07 ms e 0,1 ms de CPU nos `GET`, com a conexão reaproveitada |
| Procura da janela da Riot no observador (206 janelas, 9 candidatas) | 0,59 ms e 584 KB alocados (buffer de 64 KB por janela) | 0,06 ms e 4 KB, lembrando o resultado por janela |
| Lista de processos por Toolhelp (233 processos, 3.140 threads) | 4,7 ms de CPU | não mudou |
| Thread nova por tarefa de timer | 0,12 ms | não mudou |

## O que entrou na 2.29.0 e o que ficou de fora

1. [[riotTransport]] e [[backend]]: certificado guardado e `GET` com a conexão reaproveitada ([[ADR-051 Certificado guardado e conexão reaproveitada na API local]]). O lockfile continua lido a cada pedido: é barato e muda quando a Riot reinicia.
2. [[riotWindowObserver]] e [[win32]]: resultado lembrado por janela e buffer pequeno. As rodadas de 180 ms ficaram: espaçá-las com a Riot fechada pouparia uns 0,03% de um núcleo e atrasaria os cartões em até 1 s. As duas leituras de pixels por rodada não foram juntadas, porque só dá para conferir na Riot real.
3. [[riotOverlay]] e [[manager-preload]]: nada de leitura do login com a Riot minimizada, webviews em descanso com a Riot fechada, a conta conectada ou o login fora da tela, e a página escondida sem consultar eventos. Ficaram de fora: descanso com a Riot minimizada ou com aviso, para a volta continuar instantânea e sem quadro em branco; suspender a WebView2 (`TrySuspend`), que pararia o JavaScript dos cartões; e parar a consulta com um login esperando.
4. Processos de renderização: de 3 para 2, não para 1 ([[ADR-052 Webviews da sobreposição num processo só]]). Juntar os três exige primeiro um teste fora do repositório.
5. Não mexidos: lista de processos a cada 4 s no [[sessionKeeper]], thread por tarefa nos [[timers]], conexão nova por pedido no [[rankApi]], nove leituras por minuto no [[gameRanks]] com o League aberto e um `data.json` gravado por conta atualizada no [[store]].

Não medido: a 2.29.0 com a Riot minimizada, com a conta conectada (webviews em descanso) ou fechada, porque a Riot ficou visível na tela de login o tempo todo e o agente não mexe nela; as duas leituras de pixels da tela por rodada do observador (exigiria capturar a tela, ver [[Testes sem o usuário]]); e o tamanho real da lista de presenças do VALORANT.

## Relacionado

- [[Memória]]
- [[Laboratório de velocidade do login]]
- [[Changelog]]
