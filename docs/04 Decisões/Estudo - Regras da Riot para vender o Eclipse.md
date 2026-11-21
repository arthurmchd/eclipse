---
tipo: estudo
data: 2026-11-21
tags: [estudo, riot, distribuição]
---

# Estudo - Regras da Riot para vender o Eclipse

Pedido do usuário em 2026-11-21: saber se o Eclipse poderia ser vendido como produto profissional. Este estudo resume as regras públicas da Riot encontradas nessa data. Não é parecer jurídico; antes de cobrar, a pergunta vai para a própria Riot.

## O que as regras dizem

- **Monetização exige registro e aprovação.** As políticas gerais para desenvolvedores (atualizadas em 2025-03-11) só permitem monetizar um produto registrado no Developer Portal com status "Approved" ou "Acknowledged". A monetização não pode ser abusiva, a critério da Riot, e não pode envolver aposta. Quem descumpre pode perder o acesso à API ou sofrer ação legal.
- **Sem anúncios dentro da Riot.** A Riot proibiu anúncios de terceiros dentro do jogo, em sobreposições, telas de carregamento e no Riot Client. O Eclipse é uma sobreposição no Riot Client: anúncios nele estão fora de questão.
- **Conta é pessoal.** Os Termos de Serviço proíbem vender, transferir ou dar acesso a uma conta ou às credenciais dela. Um gerenciador de contas é aceitável para as contas do próprio jogador. Qualquer recurso de compartilhar contas entre pessoas viola os termos.
- **API local não é a API oficial.** O programa de desenvolvedores cobre a Riot API pública. O Eclipse usa o serviço local do Riot Client, que não é documentado nem suportado, e automatiza o login. Não foi encontrada regra pública que trate desse caso. Resumos de terceiros do Código de Conduta citam a proibição de "software não autorizado que interfira nos serviços", mas não foi possível confirmar essa redação nas páginas da Riot.

## Conclusão

- **Gratuito, como projeto de fã:** é o modelo atual (README e releases com aviso de projeto de fã). O risco é baixo, mas não é zero, porque a automação do login não tem regra clara.
- **Pago:** só depois de registrar o produto no Developer Portal e obter "Approved" ou "Acknowledged". Como a Riot pode recusar um produto que automatiza o login pela API local, a chance de aprovação é incerta. Sem aprovação, cobrar arrisca a retirada do projeto e problemas para as contas dos usuários.
- **Recomendação:** manter gratuito. Se o usuário quiser cobrar, registrar o Eclipse no Developer Portal e perguntar à Riot antes, descrevendo a automação do login e o uso do serviço local.

## Fontes

- [Políticas gerais para desenvolvedores](https://developer.riotgames.com/policies/general)
- [Developer API Policy](https://support-developer.riotgames.com/hc/en-us/articles/22698769097107)
- [Aplicativos de terceiros (League of Legends)](https://support-leagueoflegends.riotgames.com/hc/en-us/articles/225266848)
- [Posição da Riot sobre aplicativos de terceiros](https://support.riotgames.com/en-us/riot/events/third-party-applications)
- [Termos de Serviço](https://www.riotgames.com/en/terms-of-service)
- [Guia de conformidade da Overwolf para jogos da Riot](https://dev.overwolf.com/ow-native/guides/game-compliance/riot-games)

## Relacionado

- [[Publicar no GitHub]]
- [[Limitações conhecidas]]
