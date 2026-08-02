# Changelog

## [0.1.196](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.195...auxx-v0.1.196) (2026-08-02)


### Bug Fixes

* **lambda:** type the execution timeout handle environment-agnostically ([#1504](https://github.com/Auxx-Ai/auxx-ai/issues/1504)) ([96042c1](https://github.com/Auxx-Ai/auxx-ai/commit/96042c159dc0cf8ad44f96835365e09408efc7a5))

## [0.1.195](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.194...auxx-v0.1.195) (2026-08-02)


### Features

* **permissions:** articles inherit their knowledge base's grants ([#1501](https://github.com/Auxx-Ai/auxx-ai/issues/1501)) ([76b51a8](https://github.com/Auxx-Ai/auxx-ai/commit/76b51a84c7a61240df3715319086180c546eb1ed))


### Bug Fixes

* fail closed when callback auth is not configured ([#1503](https://github.com/Auxx-Ai/auxx-ai/issues/1503)) ([ac74460](https://github.com/Auxx-Ai/auxx-ai/commit/ac744605b884abebc45220d96ba7566f552e01f1))
* **kb:** autosize article title and description fields ([#1497](https://github.com/Auxx-Ai/auxx-ai/issues/1497)) ([c05d8a7](https://github.com/Auxx-Ai/auxx-ai/commit/c05d8a7a3c92dde34dbcf4aeccb809bcc75f4da8))
* **kb:** gate preview routes and learned-memory readers on kb access ([#1499](https://github.com/Auxx-Ai/auxx-ai/issues/1499)) ([607065e](https://github.com/Auxx-Ai/auxx-ai/commit/607065e3e8d6b98e96583773c814ff4f59eb261a))
* remove ambient secrets from the code-execution sandbox ([#1502](https://github.com/Auxx-Ai/auxx-ai/issues/1502)) ([2e1a99a](https://github.com/Auxx-Ai/auxx-ai/commit/2e1a99a77950bf4cf99892a3b6b3262c45ff3aab))
* require org membership for dev app installs ([#1498](https://github.com/Auxx-Ai/auxx-ai/issues/1498)) ([b7d2a40](https://github.com/Auxx-Ai/auxx-ai/commit/b7d2a40bce06e5bf4c5ecfa75545da097fd943fb))
* **search:** gate participant lookup and drop a phantom column ([#1500](https://github.com/Auxx-Ai/auxx-ai/issues/1500)) ([93461d8](https://github.com/Auxx-Ai/auxx-ai/commit/93461d855fe7dc300781995cd54749b0b837a81b))
* unblock record hydration for kb/dataset and fix audit sessionId ([#1495](https://github.com/Auxx-Ai/auxx-ai/issues/1495)) ([982c6ba](https://github.com/Auxx-Ai/auxx-ai/commit/982c6ba5ec7ac1241e33398a4e9f43d62c2bf1a2))

## [0.1.194](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.193...auxx-v0.1.194) (2026-08-01)


### Bug Fixes

* resolve aliased field refs and report concrete LLM client names ([#1492](https://github.com/Auxx-Ai/auxx-ai/issues/1492)) ([8469903](https://github.com/Auxx-Ai/auxx-ai/commit/84699035c12f365fa14d7c0b2d9b1edb46818622))

## [0.1.193](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.192...auxx-v0.1.193) (2026-08-01)


### Features

* **demo:** block app installs and realign the demo credit pool ([#1458](https://github.com/Auxx-Ai/auxx-ai/issues/1458)) ([f7fcc8c](https://github.com/Auxx-Ai/auxx-ai/commit/f7fcc8ce7e886f4309d1e314ec0ba3c9dc7cbef7))


### Bug Fixes

* **ai:** clear the kopilot and provider type errors and the bugs they were hiding ([#1457](https://github.com/Auxx-Ai/auxx-ai/issues/1457)) ([ee376df](https://github.com/Auxx-Ai/auxx-ai/commit/ee376dfb8f943d5616ebd7e815408da411f11992))
* **ai:** meter streamed llm usage and repair the ai memory pipeline ([#1465](https://github.com/Auxx-Ai/auxx-ai/issues/1465)) ([181ac85](https://github.com/Auxx-Ai/auxx-ai/commit/181ac85b05d536ea06c5f6fca0aa185af56dce27))
* **channels:** dismiss the sync toast on logout ([#1462](https://github.com/Auxx-Ai/auxx-ai/issues/1462)) ([c79e628](https://github.com/Auxx-Ai/auxx-ai/commit/c79e6281b08e7b98242fd09c1e6496917075e128))
* clear 1671 type errors and the live defects they were hiding ([#1485](https://github.com/Auxx-Ai/auxx-ai/issues/1485)) ([2d7a8ce](https://github.com/Auxx-Ai/auxx-ai/commit/2d7a8ce5d354dd3ea9cf646168c68c2111b568f2))
* **conditions:** resolve system-resource filter fields addressed by cuid ([#1478](https://github.com/Auxx-Ai/auxx-ai/issues/1478)) ([b0a75db](https://github.com/Auxx-Ai/auxx-ai/commit/b0a75db2baf52fb55119bcaf994e30aafbdcd9cf))
* **dashboard:** stop offering mail-lens sources and degrade stored ones cleanly ([#1483](https://github.com/Auxx-Ai/auxx-ai/issues/1483)) ([3aaabc4](https://github.com/Auxx-Ai/auxx-ai/commit/3aaabc4a8f2fcfb29c164771d66ceda76abdd4f0))
* **data-connectors:** clear both directories' type errors and the drift behind them ([#1466](https://github.com/Auxx-Ai/auxx-ai/issues/1466)) ([05bca06](https://github.com/Auxx-Ai/auxx-ai/commit/05bca06dd7198691df432d8ce0482e3dea368182))
* **demo:** unlock dashboards for demo orgs and drop the empty single-tab bar ([#1460](https://github.com/Auxx-Ai/auxx-ai/issues/1460)) ([33588e4](https://github.com/Auxx-Ai/auxx-ai/commit/33588e464e4586a69cc6188fabef8a2fc9ea3282))
* **email:** repair the mailer's log calls, expiry rendering and transport types ([#1468](https://github.com/Auxx-Ai/auxx-ai/issues/1468)) ([c0c846e](https://github.com/Auxx-Ai/auxx-ai/commit/c0c846e5c35d5e7a4c5a3d28a132108bcb88034d))
* **files:** correct the file subsystem's types and the bugs they were hiding ([#1456](https://github.com/Auxx-Ai/auxx-ai/issues/1456)) ([5d7047f](https://github.com/Auxx-Ai/auxx-ai/commit/5d7047f37b9c901236bbd400ae03fa488834f727))
* harden rate limiter and rule tests ([#1472](https://github.com/Auxx-Ai/auxx-ai/issues/1472)) ([df6dedd](https://github.com/Auxx-Ai/auxx-ai/commit/df6dedde394b143675d9204785ec63bdaf5dca06))
* **import:** drop unsafe casts in import events and rule tests ([#1474](https://github.com/Auxx-Ai/auxx-ai/issues/1474)) ([c0e3d10](https://github.com/Auxx-Ai/auxx-ai/commit/c0e3d10f4264c4bed7913204085a006175be8cae))
* **ingest:** never let the thread-alias write roll back a message ([#1477](https://github.com/Auxx-Ai/auxx-ai/issues/1477)) ([c2e5a37](https://github.com/Auxx-Ai/auxx-ai/commit/c2e5a37b75c0c547d6b7cac546720704f4e1acfc))
* **kopilot:** repair field chips, page context, and wire ordering ([#1459](https://github.com/Auxx-Ai/auxx-ai/issues/1459)) ([aa07939](https://github.com/Auxx-Ai/auxx-ai/commit/aa0793900b7a625d27b6c81d4bec63271ffb709e))
* **kopilot:** stop invalid streamed dates from crashing block renderers ([#1490](https://github.com/Auxx-Ai/auxx-ai/issues/1490)) ([faec6a4](https://github.com/Auxx-Ai/auxx-ai/commit/faec6a4e6149934d61b8abfc6b01da56a6050a64))
* **mail:** raise the bulk thread update cap and bound its fan-out ([#1469](https://github.com/Auxx-Ai/auxx-ai/issues/1469)) ([e50bd00](https://github.com/Auxx-Ai/auxx-ai/commit/e50bd006046682278afc6bfbe6470871e6ff527f))
* **messages:** compare the sent-echo window against the candidate, not now() ([#1479](https://github.com/Auxx-Ai/auxx-ai/issues/1479)) ([f6ba7f1](https://github.com/Auxx-Ai/auxx-ai/commit/f6ba7f1a795f06cf8712ced351fd72736fdfefce))
* **messaging:** clear the channel/messaging type errors and the bugs they were hiding ([#1461](https://github.com/Auxx-Ai/auxx-ai/issues/1461)) ([4033885](https://github.com/Auxx-Ai/auxx-ai/commit/40338854174440884e688791f1389e40461556fc))
* **outlook:** correlate the sent-items echo by an x- header, exactly ([#1482](https://github.com/Auxx-Ai/auxx-ai/issues/1482)) ([9e68ed8](https://github.com/Auxx-Ai/auxx-ai/commit/9e68ed835dcfba98d22767bd53bbee58f277b677))
* **outlook:** unblock sends, derive plain text, keep conversations in one thread ([#1476](https://github.com/Auxx-Ai/auxx-ai/issues/1476)) ([51c02a3](https://github.com/Auxx-Ai/auxx-ai/commit/51c02a31bd30d71cb9c1d65c30d8d6d6bafc537e))
* **permissions:** close mail-lens holes in generic resource paths ([#1473](https://github.com/Auxx-Ai/auxx-ai/issues/1473)) ([d974249](https://github.com/Auxx-Ai/auxx-ai/commit/d97424916d1aa61ec47847f7c2a7a4a90211777b))
* report dropped filter conditions + gate single-host field-value reads ([#1475](https://github.com/Auxx-Ai/auxx-ai/issues/1475)) ([331f280](https://github.com/Auxx-Ai/auxx-ai/commit/331f2808845c8379a6776086780defb0925fa730))
* resolve KB, planning, and date parser type errors ([#1471](https://github.com/Auxx-Ai/auxx-ai/issues/1471)) ([ff895ff](https://github.com/Auxx-Ai/auxx-ai/commit/ff895ff5f1a24ff61c39f3acd17f404e27779829))
* **resources:** report dropped filters on counts, aggregates and the AI boundary ([#1481](https://github.com/Auxx-Ai/auxx-ai/issues/1481)) ([31bef83](https://github.com/Auxx-Ai/auxx-ai/commit/31bef8343b281d8308cdf7c8a805521560384ab0))
* **search:** close retrieval fail-opens and add index-backed ranked search ([#1470](https://github.com/Auxx-Ai/auxx-ai/issues/1470)) ([96db557](https://github.com/Auxx-Ai/auxx-ai/commit/96db5576958251293b9dc2c4ead82a1d8e61baad))
* **search:** rank mail subject hits above body hits ([#1480](https://github.com/Auxx-Ai/auxx-ai/issues/1480)) ([1fd8c66](https://github.com/Auxx-Ai/auxx-ai/commit/1fd8c66b326d2a5448288cd67b881871e014e662))
* **types:** clear 1021 apps/web type errors and the live defects behind them ([#1486](https://github.com/Auxx-Ai/auxx-ai/issues/1486)) ([04cc106](https://github.com/Auxx-Ai/auxx-ai/commit/04cc1067df6de4a14759ced8f2a5c9fab7c55cab))
* **types:** clear the remaining type errors outside lib and web ([#1487](https://github.com/Auxx-Ai/auxx-ai/issues/1487)) ([8a490c9](https://github.com/Auxx-Ai/auxx-ai/commit/8a490c95b2ca0294eacdc1c9eb12700228740d53))
* **types:** clear web import suppressors and burn down editor/kb errors ([#1455](https://github.com/Auxx-Ai/auxx-ai/issues/1455)) ([c1e1850](https://github.com/Auxx-Ai/auxx-ai/commit/c1e1850a68e069d3da35579b77852e9d49e87932))
* **types:** repair three stale comparisons and unblock the lib ratchet ([#1463](https://github.com/Auxx-Ai/auxx-ai/issues/1463)) ([3235a0b](https://github.com/Auxx-Ai/auxx-ai/commit/3235a0b7ddaa124beb7639a5e0a9a9c83e3a327e))
* **workflow:** clear the workflow type errors and the bugs they were hiding ([#1453](https://github.com/Auxx-Ai/auxx-ai/issues/1453)) ([9927d04](https://github.com/Auxx-Ai/auxx-ai/commit/9927d04c5bdf419022bdf3a7691021b1367e5ac1))
* **workflow:** fail the find node on a dropped filter instead of widening it ([#1489](https://github.com/Auxx-Ai/auxx-ai/issues/1489)) ([6d1c45d](https://github.com/Auxx-Ai/auxx-ai/commit/6d1c45dc42ec809a9c5bac1d461e03dbc33a8aaf))

## [0.1.192](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.191...auxx-v0.1.192) (2026-07-31)


### Features

* **billing:** make dashboards available on every plan ([#1452](https://github.com/Auxx-Ai/auxx-ai/issues/1452)) ([95f6f9a](https://github.com/Auxx-Ai/auxx-ai/commit/95f6f9a93cec07161ac50bd8128266711794c29c))


### Bug Fixes

* **homepage:** start the agent run instantly and stop clipping the procedure ring ([#1450](https://github.com/Auxx-Ai/auxx-ai/issues/1450)) ([12e10f9](https://github.com/Auxx-Ai/auxx-ai/commit/12e10f90b7b7d34e91317242bc31086e0beddfbb))

## [0.1.191](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.190...auxx-v0.1.191) (2026-07-31)


### Features

* **billing:** meter sequences with a sequencesLimit plan limit ([#1448](https://github.com/Auxx-Ai/auxx-ai/issues/1448)) ([ee6aed5](https://github.com/Auxx-Ai/auxx-ai/commit/ee6aed5e1da3437ab1cdae788910100fb9c05de4))
* **ui:** walk the list from any entity detail breadcrumb ([#1446](https://github.com/Auxx-Ai/auxx-ai/issues/1446)) ([5b066e6](https://github.com/Auxx-Ai/auxx-ai/commit/5b066e6b177c0e83beddf8a7c6c3fb1105b9c204))


### Bug Fixes

* **billing:** stop counting seeded rows against plan limits ([#1444](https://github.com/Auxx-Ai/auxx-ai/issues/1444)) ([ceade0e](https://github.com/Auxx-Ai/auxx-ai/commit/ceade0eccb39905cd033ca2fbeb2aa5ce6346ff9))
* **channels:** answer the graph subscription handshake on post ([#1449](https://github.com/Auxx-Ai/auxx-ai/issues/1449)) ([5ce99ef](https://github.com/Auxx-Ai/auxx-ai/commit/5ce99ef15f8f5a7f89311e8212bacd4ab01544cd))
* **channels:** report an in-flight sync instead of failing the click ([#1447](https://github.com/Auxx-Ai/auxx-ai/issues/1447)) ([1e90166](https://github.com/Auxx-Ai/auxx-ai/commit/1e90166800ac5bd8d8e015b698f4c89bfa6cbcf4))

## [0.1.190](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.189...auxx-v0.1.190) (2026-07-31)


### Features

* **connections:** pre-insert connection-identify hook for dedup ([#1271](https://github.com/Auxx-Ai/auxx-ai/issues/1271)) ([126be0b](https://github.com/Auxx-Ai/auxx-ai/commit/126be0b0a381252bdbff85381fade54c4169a474))
* **custom-fields:** add search + hide-system toggle to entity/field lists ([#1319](https://github.com/Auxx-Ai/auxx-ai/issues/1319)) ([ab07511](https://github.com/Auxx-Ai/auxx-ai/commit/ab075115b651932c0089870f6ad66d14953170c5))
* **dispatch:** apple-style calendar create gestures & richer context menu ([#1269](https://github.com/Auxx-Ai/auxx-ai/issues/1269)) ([4b4c625](https://github.com/Auxx-Ai/auxx-ai/commit/4b4c6252ae6aad15d3c1fb7ed44acac6320a175e))
* **dispatch:** badge-look calendar event chip colors from option palette ([#1242](https://github.com/Auxx-Ai/auxx-ai/issues/1242)) ([24c0dda](https://github.com/Auxx-Ai/auxx-ai/commit/24c0dda5f70e5a5e8acb89ba7676d857bdc06d3a))
* **dispatch:** calendar multi-select, bulk actions and visit copy/paste ([#1257](https://github.com/Auxx-Ai/auxx-ai/issues/1257)) ([197ba7b](https://github.com/Auxx-Ai/auxx-ai/commit/197ba7b9960ecb85679b702de746383c3d670668))
* **dispatch:** crop board time-grid views to a visible-hour window ([#1265](https://github.com/Auxx-Ai/auxx-ai/issues/1265)) ([6629157](https://github.com/Auxx-Ai/auxx-ai/commit/6629157ea1162554b23b0da9f52b442e3b30a5e3))
* **dispatch:** group drag-move, slot-click create and schedule copy/paste ([#1260](https://github.com/Auxx-Ai/auxx-ai/issues/1260)) ([6f4284f](https://github.com/Auxx-Ai/auxx-ai/commit/6f4284f3a157e60d65952a595a7ce90024346fd4))
* **dispatch:** horizontal timeline board view with configurable hour window ([#1241](https://github.com/Auxx-Ai/auxx-ai/issues/1241)) ([1400845](https://github.com/Auxx-Ai/auxx-ai/commit/1400845995b087f49f4c584555f31d5eefbac823))
* **dispatch:** qc photo captions, office capture and printable visit report ([#1264](https://github.com/Auxx-Ai/auxx-ai/issues/1264)) ([b699b6c](https://github.com/Auxx-Ai/auxx-ai/commit/b699b6cc0b4cafdc3ac8a332ee71ddcb5c534041))
* **dispatch:** reorganize settings into settings/money groups ([#1243](https://github.com/Auxx-Ai/auxx-ai/issues/1243)) ([543cdd2](https://github.com/Auxx-Ai/auxx-ai/commit/543cdd28ce9d14b3cf43cb59becabd0980db7f4d))
* **dispatch:** scouting photos on quotes, lines & invoices with pdf and public rendering ([#1256](https://github.com/Auxx-Ai/auxx-ai/issues/1256)) ([6d31588](https://github.com/Auxx-Ai/auxx-ai/commit/6d3158809ec3c7901ae858ece3cfaf244792a1ce))
* **dispatch:** series-end symmetry — resumable skip-future, ends editor, visible series state ([#1250](https://github.com/Auxx-Ai/auxx-ai/issues/1250)) ([ff967b6](https://github.com/Auxx-Ai/auxx-ai/commit/ff967b627de61f299b85659a3998e640568f49ec))
* **dispatch:** surgical visit cache patches instead of invalidate/refetch ([#1261](https://github.com/Auxx-Ai/auxx-ai/issues/1261)) ([3cd0c6d](https://github.com/Auxx-Ai/auxx-ai/commit/3cd0c6d7999ea65f1aeb0f2baa189782d71676b6))
* **dispatch:** sync sent invoices to quickbooks online ([#1270](https://github.com/Auxx-Ai/auxx-ai/issues/1270)) ([11063f9](https://github.com/Auxx-Ai/auxx-ai/commit/11063f955b8e6f1cc79ba6c5d558ab9482396ab7))
* **dispatch:** teams as dispatchable worker rows + worker actor kind ([#1272](https://github.com/Auxx-Ai/auxx-ai/issues/1272)) ([f987016](https://github.com/Auxx-Ai/auxx-ai/commit/f98701647598de11d168aec7a6cf8ee92a60b9e2))
* **dispatch:** timeline lane-height drag, tiered chips & hide off-work days ([#1266](https://github.com/Auxx-Ai/auxx-ai/issues/1266)) ([c920ab0](https://github.com/Auxx-Ai/auxx-ai/commit/c920ab0eb41f431d8473c8a593543683bc73bd3c))
* **dispatch:** timeline zoom + drag time pills + resizable worker rail ([#1244](https://github.com/Auxx-Ai/auxx-ai/issues/1244)) ([25b60b0](https://github.com/Auxx-Ai/auxx-ai/commit/25b60b081d27df095e25a08271b1e052851255e5))
* **dispatch:** unify worker dialog with create flow, shared footer, and card menu ([#1245](https://github.com/Auxx-Ai/auxx-ai/issues/1245)) ([fa9381b](https://github.com/Auxx-Ai/auxx-ai/commit/fa9381bcdb5a00c32dcdb15f92b7711c7b386f68))
* **dispatch:** vertical grid hour zoom, gutter drag handles, off-day shading ([#1247](https://github.com/Auxx-Ai/auxx-ai/issues/1247)) ([f03cd09](https://github.com/Auxx-Ai/auxx-ai/commit/f03cd09317ff4f5dddd1c982a02f085dba5e73a7))
* **fields:** multiline text wrapping + field panel cleanup ([#1325](https://github.com/Auxx-Ai/auxx-ai/issues/1325)) ([8c31950](https://github.com/Auxx-Ai/auxx-ai/commit/8c3195024fb052c4e5c5de35307bd58b83568e4b))
* **fields:** single-input address field with local parse and geocoder normalization ([#1248](https://github.com/Auxx-Ai/auxx-ai/issues/1248)) ([79699d7](https://github.com/Auxx-Ai/auxx-ai/commit/79699d74a17b628753736dbfc4a8393965fc7d66))
* **homepage:** add integrations marquee and mcp sections to the integration page ([#1389](https://github.com/Auxx-Ai/auxx-ai/issues/1389)) ([b2bedea](https://github.com/Auxx-Ai/auxx-ai/commit/b2bedeadedef3fa4bbd64feb5a9b7fe86836b4bb))
* **homepage:** add sequences platform page and expand sitemap ([#1392](https://github.com/Auxx-Ai/auxx-ai/issues/1392)) ([489a2e5](https://github.com/Auxx-Ai/auxx-ai/commit/489a2e55723bbf4665723fae1af9329bebf603ac))
* **homepage:** agents platform page with procedure runs and evals ([#1411](https://github.com/Auxx-Ai/auxx-ai/issues/1411)) ([9add778](https://github.com/Auxx-Ai/auxx-ai/commit/9add778541940360308edf6307b1076bb30ad4ee))
* **homepage:** crm access/platform sections + agents architecture guide ([#1407](https://github.com/Auxx-Ai/auxx-ai/issues/1407)) ([58f09ff](https://github.com/Auxx-Ai/auxx-ai/commit/58f09ff6bb9838691f3f7a1a3c6885fbb603b209))
* **homepage:** dispatch feature page + industries landing pages ([#1240](https://github.com/Auxx-Ai/auxx-ai/issues/1240)) ([2e6d317](https://github.com/Auxx-Ai/auxx-ai/commit/2e6d317ce3d6ddf61c943f52c1001073e122a74d))
* **homepage:** fill blog cards with the post image ([#1408](https://github.com/Auxx-Ai/auxx-ai/issues/1408)) ([5688fe4](https://github.com/Auxx-Ai/auxx-ai/commit/5688fe4d998647dbacaea37d3b09168ce1e1233d))
* **kb:** make site access one choice instead of two disagreeing ones ([#1377](https://github.com/Auxx-Ai/auxx-ai/issues/1377)) ([523ad11](https://github.com/Auxx-Ai/auxx-ai/commit/523ad113c114517612086e550ac8c09cf73d55e4))
* **mail:** add shared with me ([#1324](https://github.com/Auxx-Ai/auxx-ai/issues/1324)) ([e936406](https://github.com/Auxx-Ai/auxx-ai/commit/e9364065a24a5f14f93dafeb87bfaf98825d0ac7))
* **mail:** let a member delete their own personal inbox ([#1397](https://github.com/Auxx-Ai/auxx-ai/issues/1397)) ([edf811f](https://github.com/Auxx-Ai/auxx-ai/commit/edf811f93089d11f736d26955f001ed4505dbb6c))
* **members:** bulk invite dialog with email chips ([#1341](https://github.com/Auxx-Ai/auxx-ai/issues/1341)) ([4377472](https://github.com/Auxx-Ai/auxx-ai/commit/4377472d81e9608ce85c35df69d077ebe76991f9))
* **money:** batch advance invoicing ([#1259](https://github.com/Auxx-Ai/auxx-ai/issues/1259)) ([2e9dccf](https://github.com/Auxx-Ai/auxx-ai/commit/2e9dccf38f423c3ccbd860b4652b0fd0a2099432))
* **money:** create jobs from unaccepted quotes with accept-time sync ([#1251](https://github.com/Auxx-Ai/auxx-ai/issues/1251)) ([23c9763](https://github.com/Auxx-Ai/auxx-ai/commit/23c9763ed44d0c001f419ec921359af1a8507bcf))
* **money:** line-item photo popover, migration & category badge reposition ([#1262](https://github.com/Auxx-Ai/auxx-ai/issues/1262)) ([1e432b7](https://github.com/Auxx-Ai/auxx-ai/commit/1e432b73000f26bb8b5d24caf88f54fdfa312a42))
* **notifications:** add v2 notification panel ([#1326](https://github.com/Auxx-Ai/auxx-ai/issues/1326)) ([9f5f8db](https://github.com/Auxx-Ai/auxx-ai/commit/9f5f8db766a6bb044e872bfdebb985322a343454))
* **notifications:** compose item messages with actor and target chips ([#1358](https://github.com/Auxx-Ai/auxx-ai/issues/1358)) ([ce30d16](https://github.com/Auxx-Ai/auxx-ai/commit/ce30d16a6ff481580e5e05f50b14d257696f47e3))
* **notifications:** count approvals on the bell and stop double-surfacing them ([#1376](https://github.com/Auxx-Ai/auxx-ai/issues/1376)) ([4a775af](https://github.com/Auxx-Ai/auxx-ai/commit/4a775afad8a9a1c902a7e0e09f5e910c7a3df49c))
* **notifications:** fold the today inbox into an approvals tab ([#1372](https://github.com/Auxx-Ai/auxx-ai/issues/1372)) ([3a15455](https://github.com/Auxx-Ai/auxx-ai/commit/3a15455006551ebeaa640e9b1bb43ac35138eada))
* **onboarding:** give invited members the personal step ([#1381](https://github.com/Auxx-Ai/auxx-ai/issues/1381)) ([5781410](https://github.com/Auxx-Ai/auxx-ai/commit/5781410dda8de8e1365033b998ef5febc15b79ff))
* **permissions:** access requests for records (plan v3/04) ([#1428](https://github.com/Auxx-Ai/auxx-ai/issues/1428)) ([42c4d6d](https://github.com/Auxx-Ai/auxx-ai/commit/42c4d6d5b3844ffdd8a5adcd023f809788996938))
* **permissions:** add per-agent instance access ([#1359](https://github.com/Auxx-Ai/auxx-ai/issues/1359)) ([f160c4d](https://github.com/Auxx-Ai/auxx-ai/commit/f160c4d5e4492f46fc53e9da8946c1e1efabe24f))
* **permissions:** agent knowledge scope (retrieval scope, not access) ([#1327](https://github.com/Auxx-Ai/auxx-ai/issues/1327)) ([5fe7b1a](https://github.com/Auxx-Ai/auxx-ai/commit/5fe7b1ad05d453b61a74ec2fec85f5149016388a))
* **permissions:** agent permission gating (runtime principal model) ([#1323](https://github.com/Auxx-Ai/auxx-ai/issues/1323)) ([204dfee](https://github.com/Auxx-Ai/auxx-ai/commit/204dfee47427fed78560e7f0a256a3086aaaa2b3))
* **permissions:** agent policy persistence, profile bindings, and editor polish ([#1335](https://github.com/Auxx-Ai/auxx-ai/issues/1335)) ([3ecf8b6](https://github.com/Auxx-Ai/auxx-ai/commit/3ecf8b6f9b4882257db659392b79568d66cb0b0b))
* **permissions:** area rung honesty for row-described resources (plan 43) ([#1403](https://github.com/Auxx-Ai/auxx-ai/issues/1403)) ([4419446](https://github.com/Auxx-Ai/auxx-ai/commit/441944611846c37a332bb579bd7ec807ce2f1f17))
* **permissions:** bring mail and inboxes into instance access ([#1391](https://github.com/Auxx-Ai/auxx-ai/issues/1391)) ([1402ac1](https://github.com/Auxx-Ai/auxx-ai/commit/1402ac1698344419a7d83f33fb36e4b454360ae2))
* **permissions:** bring signatures and snippets into instance access ([#1378](https://github.com/Auxx-Ai/auxx-ai/issues/1378)) ([4782615](https://github.com/Auxx-Ai/auxx-ai/commit/47826150e6425604d5d0660659c27895fc7d7666))
* **permissions:** buttonswitch ui component + search/overrides filters ([#1316](https://github.com/Auxx-Ai/auxx-ai/issues/1316)) ([261b500](https://github.com/Auxx-Ai/auxx-ai/commit/261b500c9e0c5f88495c7e7dc9ae71ab51ecbc35))
* **permissions:** client capability delivery + realtime merge ([#1276](https://github.com/Auxx-Ai/auxx-ai/issues/1276)) ([c1afce5](https://github.com/Auxx-Ai/auxx-ai/commit/c1afce5805aa62e5f20407a519ae298c031925c6))
* **permissions:** comments capability + agents/comment enforcement + no-access ([#1281](https://github.com/Auxx-Ai/auxx-ai/issues/1281)) ([385894e](https://github.com/Auxx-Ai/auxx-ai/commit/385894e208f89de0c0189c806abc801ea8a45737))
* **permissions:** connectors l2 area (none/full), loosen admin gate to connectors.manage ([#1311](https://github.com/Auxx-Ai/auxx-ai/issues/1311)) ([2668b1e](https://github.com/Auxx-Ai/auxx-ai/commit/2668b1eaec1f75947d99ed2a98c00e35e602cb5a))
* **permissions:** cross-link group members and member teams to detail pages ([#1285](https://github.com/Auxx-Ai/auxx-ai/issues/1285)) ([0b50e8f](https://github.com/Auxx-Ai/auxx-ai/commit/0b50e8fa894c10457771e93b450b0ea1af6f8dfd))
* **permissions:** dashboard instance-access (l2 area + per-dashboard sharing) ([#1322](https://github.com/Auxx-Ai/auxx-ai/issues/1322)) ([e660f10](https://github.com/Auxx-Ai/auxx-ai/commit/e660f10bac8f7c496d5cd57fdbf5f24603a050a4))
* **permissions:** dashboards edit rung, ui gating, and instance-access test backfill ([#1344](https://github.com/Auxx-Ai/auxx-ai/issues/1344)) ([e0093cf](https://github.com/Auxx-Ai/auxx-ai/commit/e0093cf66b7964f49996501c5409a2db10424322))
* **permissions:** datasets instance-access (l2 area + per-dataset sharing) ([#1313](https://github.com/Auxx-Ai/auxx-ai/issues/1313)) ([a813c50](https://github.com/Auxx-Ai/auxx-ai/commit/a813c50d6f2c98cc179920bbba9bc547b14e82cb))
* **permissions:** def administration (Full) enforcement ([#1303](https://github.com/Auxx-Ai/auxx-ai/issues/1303)) ([7b792c5](https://github.com/Auxx-Ai/auxx-ai/commit/7b792c5892f692e7abf3c219e2b1b92c8a3122a5))
* **permissions:** definition ceilings, escalation guard, profile grantee sweep ([#1333](https://github.com/Auxx-Ai/auxx-ai/issues/1333)) ([ff4c37f](https://github.com/Auxx-Ai/auxx-ai/commit/ff4c37f371958bbe2bf9e9b5257d03529d3db775))
* **permissions:** derive the area read key from instance grants ([#1348](https://github.com/Auxx-Ai/auxx-ai/issues/1348)) ([8d3f1e9](https://github.com/Auxx-Ai/auxx-ai/commit/8d3f1e93f57cd5d6b2e1a57c4067211ef5351b47))
* **permissions:** enforce def-level restriction on the record read path ([#1288](https://github.com/Auxx-Ai/auxx-ai/issues/1288)) ([d9023c8](https://github.com/Auxx-Ai/auxx-ai/commit/d9023c82d5f17a717b105cb244309385a3a2e27e))
* **permissions:** enforce def-level write path (records, field values, tickets) ([#1290](https://github.com/Auxx-Ai/auxx-ai/issues/1290)) ([50c0719](https://github.com/Auxx-Ai/auxx-ai/commit/50c07196c71270f7930d3e39fbc3dd4307399d95))
* **permissions:** enforce settings-admin areas at the router layer ([#1299](https://github.com/Auxx-Ai/auxx-ai/issues/1299)) ([3d9638b](https://github.com/Auxx-Ai/auxx-ai/commit/3d9638b3661de9cc34a365a5134deee3f39b00c0))
* **permissions:** expandable per-def and per-instance access rows in all permission grids ([#1339](https://github.com/Auxx-Ai/auxx-ai/issues/1339)) ([c0da1cc](https://github.com/Auxx-Ai/auxx-ai/commit/c0da1cc2b1c941a93a52d5f2dcfdb7b8123a2dc8))
* **permissions:** explicit instance grant overrides an area level of none ([#1346](https://github.com/Auxx-Ai/auxx-ai/issues/1346)) ([87f9d70](https://github.com/Auxx-Ai/auxx-ai/commit/87f9d70351ce68cf7ec5b46f8ea903ea4572ac49))
* **permissions:** expose def-access to the client, gate record UI per def ([#1291](https://github.com/Auxx-Ai/auxx-ai/issues/1291)) ([646cc0a](https://github.com/Auxx-Ai/auxx-ai/commit/646cc0aaf80017924bbbac3dfb89809e804e628c))
* **permissions:** field-seat management ui + invitation seat type ([#1278](https://github.com/Auxx-Ai/auxx-ai/issues/1278)) ([d45482c](https://github.com/Auxx-Ai/auxx-ai/commit/d45482c0de4bf0e6e386086c81d87c8916354998))
* **permissions:** files L2 area (None/Read/Full) enforcement + UI gating ([#1306](https://github.com/Auxx-Ai/auxx-ai/issues/1306)) ([499b65c](https://github.com/Auxx-Ai/auxx-ai/commit/499b65c3a2083706460f0e30ad16a831661df1d2))
* **permissions:** filter restricted defs out of nav and pickers ([#1296](https://github.com/Auxx-Ai/auxx-ai/issues/1296)) ([47793be](https://github.com/Auxx-Ai/auxx-ai/commit/47793beece11b7da198af3a9869b3876da93b444))
* **permissions:** fold agent policy into the profile area tree ([#1347](https://github.com/Auxx-Ai/auxx-ai/issues/1347)) ([4342ae9](https://github.com/Auxx-Ai/auxx-ai/commit/4342ae99bf3696089affdc978c79ec3214e29626))
* **permissions:** gate 'create field' + import command-palette actions ([#1309](https://github.com/Auxx-Ai/auxx-ai/issues/1309)) ([e771dba](https://github.com/Auxx-Ai/auxx-ai/commit/e771dba1088f408dfea1f337a471b3667d06e691))
* **permissions:** gate drawer and detail-view cards on a layer-2 key ([#1297](https://github.com/Auxx-Ai/auxx-ai/issues/1297)) ([14b30a7](https://github.com/Auxx-Ai/auxx-ai/commit/14b30a72ef2d13e00580cc3ecbd99b392fdd91f6))
* **permissions:** gate file-library upload presign on files.manage ([#1307](https://github.com/Auxx-Ai/auxx-ai/issues/1307)) ([5f6f8e3](https://github.com/Auxx-Ai/auxx-ai/commit/5f6f8e3269e1c53aa1a59094eaebf34c3456d042))
* **permissions:** gate record-write affordances on canEditEntity ([#1302](https://github.com/Auxx-Ai/auxx-ai/issues/1302)) ([3c451d0](https://github.com/Auxx-Ai/auxx-ai/commit/3c451d089d836536ebc0cc76b53c4fcfdadc0fbc))
* **permissions:** grantable settings-admin areas + functional settings nav ([#1298](https://github.com/Auxx-Ai/auxx-ai/issues/1298)) ([a9679a2](https://github.com/Auxx-Ai/auxx-ai/commit/a9679a2896245d96874586b2c31390ea88846011))
* **permissions:** grantee override list with selectable levels and ignored warning ([#1287](https://github.com/Auxx-Ai/auxx-ai/issues/1287)) ([98e4236](https://github.com/Auxx-Ai/auxx-ai/commit/98e4236790f806852b7502ead2b0615c8710d55c))
* **permissions:** grantee-centric def-access ui + fix type-grant dup rows ([#1292](https://github.com/Auxx-Ai/auxx-ai/issues/1292)) ([f2de484](https://github.com/Auxx-Ai/auxx-ai/commit/f2de4849d48053acad083a17cc3dbbe0907dccac))
* **permissions:** group detail view with editable general + user members ([#1284](https://github.com/Auxx-Ai/auxx-ai/issues/1284)) ([68b264a](https://github.com/Auxx-Ai/auxx-ai/commit/68b264a9c3c5c44a9c22a538cdf6d91f9ed2c147))
* **permissions:** honour per-kb instance access in apps/kb ([#1366](https://github.com/Auxx-Ai/auxx-ai/issues/1366)) ([0d23de7](https://github.com/Auxx-Ai/auxx-ai/commit/0d23de779f5b847dc012f7a06738e9a76e0074e4))
* **permissions:** kb instance-access (l2 area + per-kb sharing) ([#1317](https://github.com/Auxx-Ai/auxx-ai/issues/1317)) ([9dc319f](https://github.com/Auxx-Ai/auxx-ai/commit/9dc319f462ff7bfdb11b0986ec5b99167d3a361f))
* **permissions:** kb/dataset ui capability enforcement and segment router asserts ([#1338](https://github.com/Auxx-Ai/auxx-ai/issues/1338)) ([fcca2ca](https://github.com/Auxx-Ai/auxx-ai/commit/fcca2cacfb430ae1cd472da5c28e0ed8e7356e8d))
* **permissions:** leveled capability layer + worker seat ([#1275](https://github.com/Auxx-Ai/auxx-ai/issues/1275)) ([fa5bfdb](https://github.com/Auxx-Ai/auxx-ai/commit/fa5bfdb2530d592880161fd2e6f435b3f9beb327))
* **permissions:** mail access request UI (plan 42 phase 2) ([#1401](https://github.com/Auxx-Ai/auxx-ai/issues/1401)) ([8c57392](https://github.com/Auxx-Ai/auxx-ai/commit/8c573920772b5b3415377af8fa203e8d64aa763f))
* **permissions:** mail access requests backend (plan 42 phase 1) ([#1399](https://github.com/Auxx-Ai/auxx-ai/issues/1399)) ([3005c4e](https://github.com/Auxx-Ai/auxx-ai/commit/3005c4e5a07e79be43950f11e68380a1412fdca5))
* **permissions:** make record delete and import grantable per definition ([#1387](https://github.com/Auxx-Ai/auxx-ai/issues/1387)) ([5463270](https://github.com/Auxx-Ai/auxx-ai/commit/546327062dfa9825e6b506791a2fd9969a09b4b6))
* **permissions:** make settings delegable and retire the client role gates ([#1386](https://github.com/Auxx-Ai/auxx-ai/issues/1386)) ([1157f55](https://github.com/Auxx-Ai/auxx-ai/commit/1157f5527a59c19e99e14d563580364dd6c811d3))
* **permissions:** member baseline strip - unset means none ([#1337](https://github.com/Auxx-Ai/auxx-ai/issues/1337)) ([80e3cb2](https://github.com/Auxx-Ai/auxx-ai/commit/80e3cb2e7f58213c8ba00517966b3a35ea0e1be0))
* **permissions:** member detail view with teams, accounts, and removal ([#1283](https://github.com/Auxx-Ai/auxx-ai/issues/1283)) ([9e1c6a8](https://github.com/Auxx-Ai/auxx-ai/commit/9e1c6a8b3ea1bbd40a2f938abdc139a0b16ad481))
* **permissions:** move the agent tab's notices into the section header ([#1362](https://github.com/Auxx-Ai/auxx-ai/issues/1362)) ([8f6eb9e](https://github.com/Auxx-Ai/auxx-ai/commit/8f6eb9e0eef19dbd69f66a19e7b04222625a82ae))
* **permissions:** per-def workspace baselines on the permissions page ([#1321](https://github.com/Auxx-Ai/auxx-ai/issues/1321)) ([c1abb90](https://github.com/Auxx-Ai/auxx-ai/commit/c1abb90a6a3b6b89168cebd47298833347c1121c))
* **permissions:** per-record instance access on a unified rung ladder (plan v3/03) ([#1406](https://github.com/Auxx-Ai/auxx-ai/issues/1406)) ([4e62d22](https://github.com/Auxx-Ai/auxx-ai/commit/4e62d225529f37875fc9148d779df7d915c56389))
* **permissions:** permission profiles substrate, agent published policy, author clamp ([#1332](https://github.com/Auxx-Ai/auxx-ai/issues/1332)) ([e8d3ac6](https://github.com/Auxx-Ai/auxx-ai/commit/e8d3ac67ca6caeb5ff2027acb41d4f6f0fd1baf7))
* **permissions:** personalize shared table views ([#1312](https://github.com/Auxx-Ai/auxx-ai/issues/1312)) ([9202ac1](https://github.com/Auxx-Ai/auxx-ai/commit/9202ac13270dc1989a82e6d77d63dcc6f198d996))
* **permissions:** plan gating on authoring paths and curated agent preset profiles ([#1340](https://github.com/Auxx-Ai/auxx-ai/issues/1340)) ([55ed21d](https://github.com/Auxx-Ai/auxx-ai/commit/55ed21db077abb221c06f6637085b9b885cd0567))
* **permissions:** profile editor header hero, save bar, and ladder alignment ([#1343](https://github.com/Auxx-Ai/auxx-ai/issues/1343)) ([0ae656e](https://github.com/Auxx-Ai/auxx-ai/commit/0ae656e6cf3415630b2c1d5864a6bb932fcc0c1f))
* **permissions:** reach custom fields via def-admin, keep permissions tab admin-only ([#1308](https://github.com/Auxx-Ai/auxx-ai/issues/1308)) ([c99cbc4](https://github.com/Auxx-Ai/auxx-ai/commit/c99cbc4ecb88668a87a0c18945aeddd899efd175))
* **permissions:** redact relationship values pointing at non-viewable defs ([#1295](https://github.com/Auxx-Ai/auxx-ai/issues/1295)) ([c9abe5b](https://github.com/Auxx-Ai/auxx-ai/commit/c9abe5bd25228ad94bf443244ad1a3bdd4768aa1))
* **permissions:** restricted record drawer for field seats ([#1279](https://github.com/Auxx-Ai/auxx-ai/issues/1279)) ([d31083a](https://github.com/Auxx-Ai/auxx-ai/commit/d31083afcd31b3f8b9e83d29649fb21de2ed7f8c))
* **permissions:** retire role as an access authority ([#1336](https://github.com/Auxx-Ai/auxx-ai/issues/1336)) ([c39e725](https://github.com/Auxx-Ai/auxx-ai/commit/c39e725f161c2903f9a2dec8667bfddbb8e2c445))
* **permissions:** scope grantee def and area reads to one grantee ([#1353](https://github.com/Auxx-Ai/auxx-ai/issues/1353)) ([83a8c47](https://github.com/Auxx-Ai/auxx-ai/commit/83a8c478c506ee541b2043f0a14ce0b0f0fd57ba))
* **permissions:** seat-class billing — worker seats + seed gap ([#1280](https://github.com/Auxx-Ai/auxx-ai/issues/1280)) ([59716c1](https://github.com/Auxx-Ai/auxx-ai/commit/59716c18685dd2b7e1b909373639dcaf90bf1747))
* **permissions:** settings page with member baseline and group/user overrides ([#1286](https://github.com/Auxx-Ai/auxx-ai/issues/1286)) ([0e78863](https://github.com/Auxx-Ai/auxx-ai/commit/0e788631e7b243c500ee0f1c34b541df424444a7))
* **permissions:** simplify permission profiles and remove the authored ceiling ([#1334](https://github.com/Auxx-Ai/auxx-ai/issues/1334)) ([b336f94](https://github.com/Auxx-Ai/auxx-ai/commit/b336f94f3178aa2305f0a5b22998ad9d13394fba))
* **permissions:** stage every grid edit behind a save bar ([#1422](https://github.com/Auxx-Ai/auxx-ai/issues/1422)) ([3e2d688](https://github.com/Auxx-Ai/auxx-ai/commit/3e2d68800705a917ffa4148829e25c3f3ff9d929))
* **permissions:** table-view def-admin gating + client canAdministerDef helper ([#1305](https://github.com/Auxx-Ai/auxx-ai/issues/1305)) ([1b06192](https://github.com/Auxx-Ai/auxx-ai/commit/1b06192fb2a5ac7dbc191e2beaeb6315b659b7c2))
* **permissions:** unify agent and user permission ui vocabulary and widgets ([#1342](https://github.com/Auxx-Ai/auxx-ai/issues/1342)) ([20ce3b6](https://github.com/Auxx-Ai/auxx-ai/commit/20ce3b63556557a5952f6b8194ff2b5395f29671))
* **permissions:** unify members and groups into a tabbed settings page ([#1282](https://github.com/Auxx-Ai/auxx-ai/issues/1282)) ([30ae1cc](https://github.com/Auxx-Ai/auxx-ai/commit/30ae1cc48d8d2e932cce7b199146e3ed3f82456e))
* **permissions:** workflows instance access with view/edit/admin rungs ([#1345](https://github.com/Auxx-Ai/auxx-ai/issues/1345)) ([a158ac1](https://github.com/Auxx-Ai/auxx-ai/commit/a158ac1f1edfbd843ff4f12dd32ba44ac6935438))
* **printing:** tree-row content page with shared sortable primitives ([#1255](https://github.com/Auxx-Ai/auxx-ai/issues/1255)) ([3dae748](https://github.com/Auxx-Ai/auxx-ai/commit/3dae7480f57a7ff84c1faac5dfe4ab3ad22da74f))
* **printing:** unified pdf print wizard — list, detail sheet, document batch ([#1253](https://github.com/Auxx-Ai/auxx-ai/issues/1253)) ([2323b3f](https://github.com/Auxx-Ai/auxx-ai/commit/2323b3fc57e69c954278d458e2b3ca6703d44498))
* **records:** add useCreateRecord canonical creation hook ([#1301](https://github.com/Auxx-Ai/auxx-ai/issues/1301)) ([2452d29](https://github.com/Auxx-Ai/auxx-ai/commit/2452d290bfd0cc8fe3fa6c2c1ec12dfe546dd3da))
* **records:** keyboard shortcuts, and the table row joins the shared actions menu ([#1443](https://github.com/Auxx-Ai/auxx-ai/issues/1443)) ([1716755](https://github.com/Auxx-Ai/auxx-ai/commit/17167552a0b8501c774b55814c3145cd68564225))
* **records:** one shared record-actions menu across page, drawer and row ([#1438](https://github.com/Auxx-Ai/auxx-ai/issues/1438)) ([37175f2](https://github.com/Auxx-Ai/auxx-ai/commit/37175f2c93963dbaed43c919c6aafe8e0c904c97))
* **records:** walk the list you came from on the record detail page ([#1442](https://github.com/Auxx-Ai/auxx-ai/issues/1442)) ([c672625](https://github.com/Auxx-Ai/auxx-ai/commit/c672625335ac3959fbdf641c190fc038b29b07cc))
* **rules:** placeholder tokens in action fields + task snooze visibility ([#1254](https://github.com/Auxx-Ai/auxx-ai/issues/1254)) ([65bfa15](https://github.com/Auxx-Ai/auxx-ai/commit/65bfa15b02e56d0812f35658b49c9ca04b39b185))
* **settings:** add search to the settings sidebar ([#1329](https://github.com/Auxx-Ai/auxx-ai/issues/1329)) ([6163ce8](https://github.com/Auxx-Ai/auxx-ai/commit/6163ce8d7945320cd7ef5b00f5a0a09e7ba480e6))
* **settings:** pin form save bar flush to the page bottom ([#1246](https://github.com/Auxx-Ai/auxx-ai/issues/1246)) ([58e13bc](https://github.com/Auxx-Ai/auxx-ai/commit/58e13bc123732587bd3be2651f87d5af804430ad))
* **sidebar:** attio-style resizable sidebar with hover-peek ([#1268](https://github.com/Auxx-Ai/auxx-ai/issues/1268)) ([edc46ea](https://github.com/Auxx-Ai/auxx-ai/commit/edc46ea18241439b4dab330e813ecf791551a868))
* **signals:** follow-ups phase 4 - signal rules, rule tasks, auto-complete on reply ([#1252](https://github.com/Auxx-Ai/auxx-ai/issues/1252)) ([9f0cdb0](https://github.com/Auxx-Ai/auxx-ai/commit/9f0cdb022409ce875a1065f06c124e6a118b5303))
* **tags:** rebuild tags settings list with tree rows and list toolbar ([#1294](https://github.com/Auxx-Ai/auxx-ai/issues/1294)) ([b90f4b0](https://github.com/Auxx-Ai/auxx-ai/commit/b90f4b06068703d34a3ed15296d0f7c9cf962a70))
* **ui:** share one breadcrumb entity switcher across seven entities ([#1369](https://github.com/Auxx-Ai/auxx-ai/issues/1369)) ([5b3a5e0](https://github.com/Auxx-Ai/auxx-ai/commit/5b3a5e0a8a9a18ad836849457c18160d9caf8432))
* **ui:** shared danger-zone card, settings polish, and entity-def access ([#1289](https://github.com/Auxx-Ai/auxx-ai/issues/1289)) ([850d92e](https://github.com/Auxx-Ai/auxx-ai/commit/850d92e5ea63297a78f9cdd93144901e22f968ba))


### Bug Fixes

* **approvals:** load pending approvals, and render form-input variables in the message ([#1373](https://github.com/Auxx-Ai/auxx-ai/issues/1373)) ([a773330](https://github.com/Auxx-Ai/auxx-ai/commit/a773330463a222d10eb3717608252c06bbdf28ec))
* **cache:** restore restricted-instance-ids-provider path ([#1390](https://github.com/Auxx-Ai/auxx-ai/issues/1390)) ([32ecbf8](https://github.com/Auxx-Ai/auxx-ai/commit/32ecbf8de88cdc24d5f1609c3e95a307b14fb1c8))
* **ci:** exclude generated .next output from the typecheck ratchet ([#1414](https://github.com/Auxx-Ai/auxx-ai/issues/1414)) ([ffc9350](https://github.com/Auxx-Ai/auxx-ai/commit/ffc935055375027edf1f231dd7cf15e4d4fef8d4))
* **ci:** exclude vitest.config.ts from the web project, and fail ci-ok on cancelled ([#1421](https://github.com/Auxx-Ai/auxx-ai/issues/1421)) ([ed8de84](https://github.com/Auxx-Ai/auxx-ai/commit/ed8de8422c51fff2434a9ec6bd1d447013f43ea3))
* **ci:** prepare the workspace before the web typecheck ratchet ([#1413](https://github.com/Auxx-Ai/auxx-ai/issues/1413)) ([3a6df49](https://github.com/Auxx-Ai/auxx-ai/commit/3a6df499014c6554ce3aae72d3059e794b34a619))
* **ci:** resolve [@auxx](https://github.com/auxx) packages to source in vitest, not dist ([#1417](https://github.com/Auxx-Ai/auxx-ai/issues/1417)) ([e32e35b](https://github.com/Auxx-Ai/auxx-ai/commit/e32e35be6ace437cbbd15b3504a2ea90bd771583))
* **ci:** unbreak the web and lib test suites, and record the typecheck baseline on a runner ([#1418](https://github.com/Auxx-Ai/auxx-ai/issues/1418)) ([026f3b2](https://github.com/Auxx-Ai/auxx-ai/commit/026f3b2acdfa47a4bcc41f7009fe80f90fa62936))
* **connections:** drive.metadata.readonly for sheets listing + stop logging tokens ([#1239](https://github.com/Auxx-Ai/auxx-ai/issues/1239)) ([ddf5f73](https://github.com/Auxx-Ai/auxx-ai/commit/ddf5f7314e21493c933a327fe538faa00c053f46))
* **deps:** let next resolve typescript while typechecking on 7 ([#1441](https://github.com/Auxx-Ai/auxx-ai/issues/1441)) ([191d691](https://github.com/Auxx-Ai/auxx-ai/commit/191d691f2fa2d52f608819159ef140e0a620a9ce))
* **dev:** stabilize local servers ([#1331](https://github.com/Auxx-Ai/auxx-ai/issues/1331)) ([a21524b](https://github.com/Auxx-Ai/auxx-ai/commit/a21524be1f1193d520290881dccc6114fb325515))
* **dispatch:** board shading for worker/team rows, cross-column drag & timeline rail polish ([#1273](https://github.com/Auxx-Ai/auxx-ai/issues/1273)) ([49776b6](https://github.com/Auxx-Ai/auxx-ai/commit/49776b6f24b56d6c66de9311fc62822577a0a30a))
* **dispatch:** full-height calendar gutter, header scroll shadow & worker row avatars ([#1274](https://github.com/Auxx-Ai/auxx-ai/issues/1274)) ([8098e37](https://github.com/Auxx-Ai/auxx-ai/commit/8098e375c3d0c8f358f8e7224d2d144a63e936c3))
* **dispatch:** keep month view on the snapped row after scroll settles ([#1267](https://github.com/Auxx-Ai/auxx-ai/issues/1267)) ([6bef06e](https://github.com/Auxx-Ai/auxx-ai/commit/6bef06e29fd423add053dfad2e7d52376bbc97ff))
* **dispatch:** single geocode per work order address write via normalize listener ([#1249](https://github.com/Auxx-Ai/auxx-ai/issues/1249)) ([542a942](https://github.com/Auxx-Ai/auxx-ai/commit/542a942af7bf7f5b33193a3c306b5fec8bd10469))
* drop the packages/services project reference and fix the 50 errors it hid ([#1430](https://github.com/Auxx-Ai/auxx-ai/issues/1430)) ([06819ab](https://github.com/Auxx-Ai/auxx-ai/commit/06819abfbd7d824339bee96de88b14b7647c615f))
* **files:** gate attachment download and thumbnail on the owning record ([#1374](https://github.com/Auxx-Ai/auxx-ai/issues/1374)) ([ec45ab8](https://github.com/Auxx-Ai/auxx-ai/commit/ec45ab81737288787bc35950ade52664e4c0e42b))
* **kb:** register the proxy from src, fix markdown caching, send search credentials ([#1375](https://github.com/Auxx-Ai/auxx-ai/issues/1375)) ([19216ff](https://github.com/Auxx-Ai/auxx-ai/commit/19216ff62b61f59b1d897591a790794f6b62c118))
* **kopilot:** keep a session on the model it started on ([#1354](https://github.com/Auxx-Ai/auxx-ai/issues/1354)) ([67b05a9](https://github.com/Auxx-Ai/auxx-ai/commit/67b05a97d6c4cd8a6a58ff7e96dc3477bc3c7428))
* **lib:** green the lib vitest suite and wire it into CI ([#1426](https://github.com/Auxx-Ai/auxx-ai/issues/1426)) ([2773f66](https://github.com/Auxx-Ai/auxx-ai/commit/2773f6630f3e99b597cf28d482e914c051691cee))
* **lib:** resolve the unresolved-import suppressors hiding errors in lib ([#1431](https://github.com/Auxx-Ai/auxx-ai/issues/1431)) ([29f1bd8](https://github.com/Auxx-Ai/auxx-ai/commit/29f1bd8edd715bf9399e3e1b5dbab9243ef31166))
* **mail:** gap the thread header's two sides and centre the left one ([#1437](https://github.com/Auxx-Ai/auxx-ai/issues/1437)) ([b697a2a](https://github.com/Auxx-Ai/auxx-ai/commit/b697a2a22c709a672882220b39d69c25470eb95b))
* **mail:** gate the sidebar's Edit Inbox on the manage rung ([#1419](https://github.com/Auxx-Ai/auxx-ai/issues/1419)) ([3e11475](https://github.com/Auxx-Ai/auxx-ai/commit/3e1147563bc0fb4b3f3c5e3c6f435bfaea91c89e))
* **mail:** restore mail reading after the v3 lens rename ([#1406](https://github.com/Auxx-Ai/auxx-ai/issues/1406) fallout) ([#1410](https://github.com/Auxx-Ai/auxx-ai/issues/1410)) ([8212a9a](https://github.com/Auxx-Ai/auxx-ai/commit/8212a9ab9bb9c6c0688da0a85da120382569c19d))
* **mail:** stop a revoked thread refetching itself in a loop ([#1416](https://github.com/Auxx-Ai/auxx-ai/issues/1416)) ([1aa16e0](https://github.com/Auxx-Ai/auxx-ai/commit/1aa16e0477ae783931ccd95eac87afe21efe2f6b))
* **mail:** thread read-state gate and count identity normalization (plan 44) ([#1404](https://github.com/Auxx-Ai/auxx-ai/issues/1404)) ([c5b0a58](https://github.com/Auxx-Ai/auxx-ai/commit/c5b0a58da0d7c4f25c5f68d7956202ba587247e8))
* **mail:** visibility refresh and invalidation fan-out (plan 45) ([#1405](https://github.com/Auxx-Ai/auxx-ai/issues/1405)) ([a7bc74f](https://github.com/Auxx-Ai/auxx-ai/commit/a7bc74ff027d0ff3eb87c3a6e078880ffbbf197d))
* **members:** bind an invited signup to the invited address ([#1379](https://github.com/Auxx-Ai/auxx-ai/issues/1379)) ([11b463e](https://github.com/Auxx-Ai/auxx-ai/commit/11b463e6b81b5e9aba01d8f2f78132c7cdd65183))
* **members:** gate billing and kopilot surfaces, and stop a stale channel cache 404 ([#1382](https://github.com/Auxx-Ai/auxx-ai/issues/1382)) ([3b1469b](https://github.com/Auxx-Ai/auxx-ai/commit/3b1469b7f65387b0db40e8e58d17c7c49ce29534))
* **members:** repair dangling model refs in role update & removal ([#1277](https://github.com/Auxx-Ai/auxx-ai/issues/1277)) ([8fd34f7](https://github.com/Auxx-Ai/auxx-ai/commit/8fd34f7170a02e195dfff0084396179030d4e0bd))
* **money:** keep remaining default line rows after editing one ([#1263](https://github.com/Auxx-Ai/auxx-ai/issues/1263)) ([31f203c](https://github.com/Auxx-Ai/auxx-ai/commit/31f203c8c25b9b677f7ac3e32d2a021408e3c03b))
* **onboarding:** bind team invites to the seeded permission profiles ([#1383](https://github.com/Auxx-Ai/auxx-ai/issues/1383)) ([1133f8f](https://github.com/Auxx-Ai/auxx-ai/commit/1133f8f02bb0e58067c110a7750fc40601882bf4))
* **permissions:** bump userCapabilities cache to v2 (new-area rollout invalidation) ([#1314](https://github.com/Auxx-Ai/auxx-ai/issues/1314)) ([2ace872](https://github.com/Auxx-Ai/auxx-ai/commit/2ace87233f3aae6de0ec530c9efd87f82fd393e3))
* **permissions:** choose the access level before writing a grant ([#1402](https://github.com/Auxx-Ai/auxx-ai/issues/1402)) ([797cf9d](https://github.com/Auxx-Ai/auxx-ai/commit/797cf9de15133534a22a589315c941a37be50c39))
* **permissions:** clamp agent policy rungs to each area's own ladder ([#1367](https://github.com/Auxx-Ai/auxx-ai/issues/1367)) ([03ea86a](https://github.com/Auxx-Ai/auxx-ai/commit/03ea86ac9b5bce545d6d1d21f5bc4d1eec8598f4))
* **permissions:** close the two fail-closed gaps left by v3/03 P5 ([#1409](https://github.com/Auxx-Ai/auxx-ai/issues/1409)) ([e807c2f](https://github.com/Auxx-Ai/auxx-ai/commit/e807c2fc988720500ce28ec83ce224ddb38d9172))
* **permissions:** gate `record.getIdentities` behind per-row view authority ([#1435](https://github.com/Auxx-Ai/auxx-ai/issues/1435)) ([bbeefab](https://github.com/Auxx-Ai/auxx-ai/commit/bbeefaba7b6c3cd3e7dbdb58489652e045ff2311))
* **permissions:** gate command-palette actions on layer-2 access ([#1320](https://github.com/Auxx-Ai/auxx-ai/issues/1320)) ([85ffd6b](https://github.com/Auxx-Ai/auxx-ai/commit/85ffd6ba5c4cc76fca6fe134bbd910b9243645ec))
* **permissions:** gate create affordances on empty states + dataset uploads ([#1318](https://github.com/Auxx-Ai/auxx-ai/issues/1318)) ([b474825](https://github.com/Auxx-Ai/auxx-ai/commit/b4748254b9b319ebabb2027ef04bedc1cd23940c))
* **permissions:** gate datasets ui on l2 area + fix realtime nav update ([#1315](https://github.com/Auxx-Ai/auxx-ai/issues/1315)) ([22a2108](https://github.com/Auxx-Ai/auxx-ai/commit/22a210880bd9e47cfebb0b632d97a0ba41831336))
* **permissions:** gate instance share affordances on instance admin ([#1355](https://github.com/Auxx-Ai/auxx-ai/issues/1355)) ([89d4a44](https://github.com/Auxx-Ai/auxx-ai/commit/89d4a449206fb4df5485819c1ef70cc1c8256006))
* **permissions:** gate related-record tabs and cards on the listed def ([#1357](https://github.com/Auxx-Ai/auxx-ai/issues/1357)) ([44a45e3](https://github.com/Auxx-Ai/auxx-ai/commit/44a45e3bea68eea78924515b3005bfd2f614cc79))
* **permissions:** gate rest routes that read org data without capabilities ([#1349](https://github.com/Auxx-Ai/auxx-ai/issues/1349)) ([bd7f163](https://github.com/Auxx-Ai/auxx-ai/commit/bd7f16352de7c484d68c77b80e3c9bcadb7f7742))
* **permissions:** gate the remaining kb write affordances on instance access ([#1365](https://github.com/Auxx-Ai/auxx-ai/issues/1365)) ([6a8c412](https://github.com/Auxx-Ai/auxx-ai/commit/6a8c412dc77c0c6430885649ae800d72a7b60770))
* **permissions:** govern tickets as an entity def, not a standalone area ([#1293](https://github.com/Auxx-Ai/auxx-ai/issues/1293)) ([c77e9a6](https://github.com/Auxx-Ai/auxx-ai/commit/c77e9a69f05719961ff9a9784ad54462da455062))
* **permissions:** key inbox grants by slug so mail visibility reads them ([#1388](https://github.com/Auxx-Ai/auxx-ai/issues/1388)) ([365c2c6](https://github.com/Auxx-Ai/auxx-ai/commit/365c2c66721c70b841b70f0b5c5e47a67b4cae6f))
* **permissions:** per-record grants never reached the `_access` stamp ([#1434](https://github.com/Auxx-Ai/auxx-ai/issues/1434)) ([b98248d](https://github.com/Auxx-Ai/auxx-ai/commit/b98248d6ae4d5c5ce7a59891dc931b724b0c3f66))
* **permissions:** request-access popover rendered its body before the preflight answered ([#1436](https://github.com/Auxx-Ai/auxx-ai/issues/1436)) ([907b08f](https://github.com/Auxx-Ai/auxx-ai/commit/907b08f42d343b7eaedc15a09d5d35fc8b7868de))
* **permissions:** restore personal-channel manage authority ([#1396](https://github.com/Auxx-Ai/auxx-ai/issues/1396)) ([9e61d12](https://github.com/Auxx-Ai/auxx-ai/commit/9e61d1294d09bc36b4895f78e1fb867da87c5d2e))
* **permissions:** route profile base writes through the escalation guard ([#1350](https://github.com/Auxx-Ai/auxx-ai/issues/1350)) ([df835c3](https://github.com/Auxx-Ai/auxx-ai/commit/df835c3534f7d527c081df91af9fe519762a292b))
* **permissions:** run the escalation guard on user-tier grants ([#1385](https://github.com/Auxx-Ai/auxx-ai/issues/1385)) ([91cea4e](https://github.com/Auxx-Ai/auxx-ai/commit/91cea4e579d08b42c2677bcef2e66a26ce1a6077))
* **permissions:** scope per-instance grantee rows to their own grantee ([#1352](https://github.com/Auxx-Ai/auxx-ai/issues/1352)) ([6017cc2](https://github.com/Auxx-Ai/auxx-ai/commit/6017cc2bc61bae4c6af70fa5b757b76cad4e7cfd))
* **permissions:** scope the attachment preview to its owning resource ([#1363](https://github.com/Auxx-Ai/auxx-ai/issues/1363)) ([918ca56](https://github.com/Auxx-Ai/auxx-ai/commit/918ca56debbfcc8c6e90547b2bde897adfe30925))
* **permissions:** show the effective access line on every area row ([#1356](https://github.com/Auxx-Ai/auxx-ai/issues/1356)) ([9a9f59d](https://github.com/Auxx-Ai/auxx-ai/commit/9a9f59db91c468b217e1d8302575aa9debafa0b0))
* **permissions:** use hydrated inbox instance access ([#1395](https://github.com/Auxx-Ai/auxx-ai/issues/1395)) ([b97fee2](https://github.com/Auxx-Ai/auxx-ai/commit/b97fee2873a0f5c38c366f631bd1da350cec6ccc))
* **printing:** enable document print style by matching entity type slugs ([#1258](https://github.com/Auxx-Ai/auxx-ai/issues/1258)) ([4b108be](https://github.com/Auxx-Ai/auxx-ai/commit/4b108be99eb5b1a05011b81f151af5ea2f358910))
* **redis:** dedupe concurrent client creation and share cache across scopes ([#1328](https://github.com/Auxx-Ai/auxx-ai/issues/1328)) ([58cead4](https://github.com/Auxx-Ai/auxx-ai/commit/58cead42ec1bd4d6eab526826cf3485e8bf37e29))
* **snippets:** make starring per-user and share seeded snippets ([#1380](https://github.com/Auxx-Ai/auxx-ai/issues/1380)) ([b3f16e7](https://github.com/Auxx-Ai/auxx-ai/commit/b3f16e7b4b7eb3f9f34aefca0c6ea4d60beca558))
* support scoped personal inbox settings ([#1393](https://github.com/Auxx-Ai/auxx-ai/issues/1393)) ([dc0de9d](https://github.com/Auxx-Ai/auxx-ai/commit/dc0de9da9fca72cdfa9a1dff58e6abe576abf2b9))
* **trpc:** surface AuxxError messages + gate table-view create-field on def-admin ([#1310](https://github.com/Auxx-Ai/auxx-ai/issues/1310)) ([0667057](https://github.com/Auxx-Ai/auxx-ai/commit/0667057a2284cbb76938ba0b0173944f4d217e18))
* **web:** declare the neverthrow dependency apps/web already imports ([#1425](https://github.com/Auxx-Ai/auxx-ai/issues/1425)) ([caa20a6](https://github.com/Auxx-Ai/auxx-ai/commit/caa20a6d5f4985bf5680b95f3c37724a5fdba12b))
* **web:** drop the dead product router and clear five router error clusters ([#1427](https://github.com/Auxx-Ai/auxx-ai/issues/1427)) ([df968f5](https://github.com/Auxx-Ai/auxx-ai/commit/df968f54107fe6cb24bd090d4d2485f3239a510b))
* **web:** flash ring on the approvals row card, default the panel to unread ([#1433](https://github.com/Auxx-Ai/auxx-ai/issues/1433)) ([896330e](https://github.com/Auxx-Ai/auxx-ai/commit/896330e3706ede5f3d34cbbc343c6c20ac6763f4))
* **web:** green the last 8 vitest files and wire web into the CI test job ([#1423](https://github.com/Auxx-Ai/auxx-ai/issues/1423)) ([1b76689](https://github.com/Auxx-Ai/auxx-ai/commit/1b7668929c51caa3819915348c77bc662733ee9c))
* **web:** permissions tree row polish — empty-state indent, ladder badges, picker width ([#1420](https://github.com/Auxx-Ai/auxx-ai/issues/1420)) ([0576591](https://github.com/Auxx-Ai/auxx-ai/commit/0576591eae9908372f1520b1a7ebe51b43558d73))
* **web:** pin the records-import SSE gate to the contract it actually has ([5c29006](https://github.com/Auxx-Ai/auxx-ai/commit/5c29006013bda7a3975811388677bfd06512e497))
* **web:** three router bugs found by typechecking src/server/api ([#1424](https://github.com/Auxx-Ai/auxx-ai/issues/1424)) ([7321168](https://github.com/Auxx-Ai/auxx-ai/commit/73211684ea6206aa2df08a4f232f7372b4f11e6e))
* **workflows:** gate the webhook test surface on instance edit ([#1371](https://github.com/Auxx-Ai/auxx-ai/issues/1371)) ([a19c68f](https://github.com/Auxx-Ai/auxx-ai/commit/a19c68f625f35b7996596ec658cf869a17c8934e))
* **workflows:** resolve the org system user for authorless scheduled runs ([#1370](https://github.com/Auxx-Ai/auxx-ai/issues/1370)) ([33d6601](https://github.com/Auxx-Ai/auxx-ai/commit/33d660194686f64ad47d3f55428020cb487b7f81))
* **workflow:** stop human-in-the-loop auto-approving production runs ([#1368](https://github.com/Auxx-Ai/auxx-ai/issues/1368)) ([fb35119](https://github.com/Auxx-Ai/auxx-ai/commit/fb351190b58b0f9123ff66a564214a804f41b384))


### Performance Improvements

* **approvals:** cut redundant queries from the approval + mail access paths ([#1400](https://github.com/Auxx-Ai/auxx-ai/issues/1400)) ([d86213a](https://github.com/Auxx-Ai/auxx-ai/commit/d86213a01b10086af1ac90351fa7a68bc1f3207d))
* **realtime:** batch pusher channel auth into one signed request ([#1432](https://github.com/Auxx-Ai/auxx-ai/issues/1432)) ([b37c58d](https://github.com/Auxx-Ai/auxx-ai/commit/b37c58d2fdc263d955e2b4b11c87f88edc5ce930))
* **web:** batch FILE ref resolution behind a shared hydration store ([#1429](https://github.com/Auxx-Ai/auxx-ai/issues/1429)) ([7f33e4d](https://github.com/Auxx-Ai/auxx-ai/commit/7f33e4d5eb8b076027d41a32c3efcf113d2a56b4))

## [0.1.189](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.188...auxx-v0.1.189) (2026-07-21)


### Features

* **dispatch:** onboarding setup wizard + getting-started checklist ([#1235](https://github.com/Auxx-Ai/auxx-ai/issues/1235)) ([dddebf7](https://github.com/Auxx-Ai/auxx-ai/commit/dddebf74649d292fab468ef1501e8b6751eeb87c))

## [0.1.188](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.187...auxx-v0.1.188) (2026-07-21)


### Bug Fixes

* **apps:** apply own-client gate to app connect methods in getBySlug ([#1231](https://github.com/Auxx-Ai/auxx-ai/issues/1231)) ([ca5c90a](https://github.com/Auxx-Ai/auxx-ai/commit/ca5c90a50eacd9da4aea15ef004355cd141c881e))
* **connections:** flag revoked oauth grants for reauth, clean stale scheduler ([#1233](https://github.com/Auxx-Ai/auxx-ai/issues/1233)) ([9d5a419](https://github.com/Auxx-Ai/auxx-ai/commit/9d5a41981fd8955bb2518a000321e8368a5f618b))
* **recording:** truthful bot outcomes, ai pipeline guards, no-recording ui ([#1234](https://github.com/Auxx-Ai/auxx-ai/issues/1234)) ([a2b9b83](https://github.com/Auxx-Ai/auxx-ai/commit/a2b9b83154a58d4bac93dbf612e1a9306811b259))

## [0.1.187](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.186...auxx-v0.1.187) (2026-07-21)


### Features

* **connections:** offer platform login or bring-your-own oauth client ([#1228](https://github.com/Auxx-Ai/auxx-ai/issues/1228)) ([d7cfff5](https://github.com/Auxx-Ai/auxx-ai/commit/d7cfff5e7dffe0b42eb217623ea8340667cb1f3e))


### Bug Fixes

* **worker:** register missing event-handler jobs (message signals, bounce) ([#1227](https://github.com/Auxx-Ai/auxx-ai/issues/1227)) ([a0968c6](https://github.com/Auxx-Ai/auxx-ai/commit/a0968c65e8da564bbe76b505ddee6e96adf0fc16))

## [0.1.186](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.185...auxx-v0.1.186) (2026-07-20)


### Bug Fixes

* google oauth scopes, oauth popup lifecycle, ci build tuning, per-page canonicals ([#1224](https://github.com/Auxx-Ai/auxx-ai/issues/1224)) ([7f0e4ed](https://github.com/Auxx-Ai/auxx-ai/commit/7f0e4ed67c5adbb877f689afd192c4c05b111e01))
* migration 035 dropped-column ref, entity apiSlug collisions, dompurify dedupe ([#1226](https://github.com/Auxx-Ai/auxx-ai/issues/1226)) ([e8a830f](https://github.com/Auxx-Ai/auxx-ai/commit/e8a830f5227591b5326e478fee298871721e2935))

## [0.1.185](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.184...auxx-v0.1.185) (2026-07-20)


### Bug Fixes

* **database:** inline usersetting rekey backfill + web 8-core docker runner ([#1222](https://github.com/Auxx-Ai/auxx-ai/issues/1222)) ([db75597](https://github.com/Auxx-Ai/auxx-ai/commit/db75597edff36eced13ff883936295c3c377e1d2))

## [0.1.184](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.183...auxx-v0.1.184) (2026-07-20)


### Bug Fixes

* **build:** unblock web/kb/build docker images via bundler-opaque resvg load ([#1220](https://github.com/Auxx-Ai/auxx-ai/issues/1220)) ([bccc776](https://github.com/Auxx-Ai/auxx-ai/commit/bccc7768e1cd88cde53c5581a93e086cd536ab5b))

## [0.1.183](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.182...auxx-v0.1.183) (2026-07-18)


### Features

* **dashboards:** compact axis labels + measured axis width ([#1195](https://github.com/Auxx-Ai/auxx-ai/issues/1195)) ([c1e0114](https://github.com/Auxx-Ai/auxx-ai/commit/c1e011433f8654fcbffd3638b8912cbae85a9e39))
* **dashboards:** entity dashboards + seeded defaults, drop hardcoded ticket dashboard (v2) ([#1197](https://github.com/Auxx-Ai/auxx-ai/issues/1197)) ([6b80cfb](https://github.com/Auxx-Ai/auxx-ai/commit/6b80cfb893cedb6db28cbf508da52041329ba305))
* **dispatch:** fold visit history into schedule disclosure + in-place line bundles ([#1206](https://github.com/Auxx-Ai/auxx-ai/issues/1206)) ([45c0428](https://github.com/Auxx-Ai/auxx-ai/commit/45c0428a42e34828dda02acc8ab1232b11281c0f))
* **dispatch:** persist board view + active date in the URL (nuqs) ([#1202](https://github.com/Auxx-Ai/auxx-ai/issues/1202)) ([cfdd232](https://github.com/Auxx-Ai/auxx-ai/commit/cfdd2323659d186f767b262d560014dfd2141b66))
* **dispatch:** scheduling, recurrence, cancel and dispatch lifecycle fixes ([#1203](https://github.com/Auxx-Ai/auxx-ai/issues/1203)) ([3fddeb6](https://github.com/Auxx-Ai/auxx-ai/commit/3fddeb6ed60ca2f88ba795c64adee11217039b62))
* **dispatch:** skip-this-and-future visits + instant line-builder adds/deletes ([#1205](https://github.com/Auxx-Ai/auxx-ai/issues/1205)) ([afe30a5](https://github.com/Auxx-Ai/auxx-ai/commit/afe30a5b982b9b544a68cde1c275f5bd3b99f2c9))
* **ingest:** machine-mail phase 1 — tier column, outlook/imap header coverage ([#1217](https://github.com/Auxx-Ai/auxx-ai/issues/1217)) ([c7b21b3](https://github.com/Auxx-Ai/auxx-ai/commit/c7b21b39dcf89dad4804c213cd3183679cd864a3))
* **messages:** automated-send rate limits — recipient cooldown + org circuit breaker ([#1216](https://github.com/Auxx-Ai/auxx-ai/issues/1216)) ([0f5b25d](https://github.com/Auxx-Ai/auxx-ai/commit/0f5b25df40d447c82dc74168305941b3042d4756))
* **messages:** rfc 3834 loop-prevention headers on automated sends ([#1215](https://github.com/Auxx-Ai/auxx-ai/issues/1215)) ([b290a28](https://github.com/Auxx-Ai/auxx-ai/commit/b290a28d689030f199b260a5c897d253baa4ecf9))
* **money:** branded customer payment receipt emails on settlement ([#1191](https://github.com/Auxx-Ai/auxx-ai/issues/1191)) ([e047b4d](https://github.com/Auxx-Ai/auxx-ai/commit/e047b4d3ebc245089f711195aecf5bfa74c8f938))
* **money:** cap payments list rows + invoice-drill fallback for full page ([#1209](https://github.com/Auxx-Ai/auxx-ai/issues/1209)) ([efff025](https://github.com/Auxx-Ai/auxx-ai/commit/efff02588daa6678d14a07f306c3e7eff6799f15))
* **money:** deposit accounting via payment allocations + acceptance realtime ([#1192](https://github.com/Auxx-Ai/auxx-ai/issues/1192)) ([475c173](https://github.com/Auxx-Ai/auxx-ai/commit/475c1730a292ddc5f61cd0ae1d68f33565265bfe))
* **money:** durable work-order billing allocations ([#1189](https://github.com/Auxx-Ai/auxx-ai/issues/1189)) ([5b38c70](https://github.com/Auxx-Ai/auxx-ai/commit/5b38c7027a9c4e4c476d3a8a86c196d78c69a86f))
* **money:** line-builder row shortcuts + optimistic bundle explode ([#1196](https://github.com/Auxx-Ai/auxx-ai/issues/1196)) ([8288b28](https://github.com/Auxx-Ai/auxx-ai/commit/8288b28bec8ca88bc9ed5f2d79923bf151dffad5))
* **money:** show invoice number in drill nav bar + section icons ([#1208](https://github.com/Auxx-Ai/auxx-ai/issues/1208)) ([3d54623](https://github.com/Auxx-Ai/auxx-ai/commit/3d546238bd8731fcfdc28a66a20921c765c62c13))
* **money:** standalone new-invoice in work-order drawer + shared billing ui ([#1212](https://github.com/Auxx-Ai/auxx-ai/issues/1212)) ([8fff65d](https://github.com/Auxx-Ai/auxx-ai/commit/8fff65d75e5e2482ce09f727a691e6a449ece52e))
* **money:** surface extra-work invoicing across billing states ([#1207](https://github.com/Auxx-Ai/auxx-ai/issues/1207)) ([e9f98f3](https://github.com/Auxx-Ai/auxx-ai/commit/e9f98f3ab47c8f5eb3b19383788c2d275741cb95))
* **money:** unit pricing + part markup + optional quote lines (plans 13/17/18) ([#1194](https://github.com/Auxx-Ai/auxx-ai/issues/1194)) ([6cbc1f8](https://github.com/Auxx-Ai/auxx-ai/commit/6cbc1f863f593524bf4d6449f40cc59ba1e5ee9b))
* **sequences:** block deleting seeded template sequences ([#1219](https://github.com/Auxx-Ai/auxx-ai/issues/1219)) ([84f8f0a](https://github.com/Auxx-Ai/auxx-ai/commit/84f8f0a8870783f28658a17ca71993b8b27a2c40))
* **sequences:** suppression list tab on channels settings ([#1218](https://github.com/Auxx-Ai/auxx-ai/issues/1218)) ([ebe3983](https://github.com/Auxx-Ai/auxx-ai/commit/ebe39833aa0d41867f3f4f3f657b54cf730b40d8))
* **signals:** machine-mail guard — tiered gates, ndr bounce suppression, answer-node reply-to ([#1214](https://github.com/Auxx-Ai/auxx-ai/issues/1214)) ([b1cb243](https://github.com/Auxx-Ai/auxx-ai/commit/b1cb243ee3840014797fe5714ef30f8a9d6bafde))
* **signals:** phase 0+1 — substrate, ses ingestion, unsubscribe + send suppression ([#1210](https://github.com/Auxx-Ai/auxx-ai/issues/1210)) ([99a74d5](https://github.com/Auxx-Ai/auxx-ai/commit/99a74d51f1f27532425f904f3b40f0371456f6ed))
* **signals:** phase 2 — email open pixel + click wrapping ([#1211](https://github.com/Auxx-Ai/auxx-ai/issues/1211)) ([dc76da3](https://github.com/Auxx-Ai/auxx-ai/commit/dc76da3d7b92ae074c8b8ece89d7bafcd6e806e2))
* **ui:** main-page slot portals, tabs primitive, useDockedPanels + entity route shells ([#1199](https://github.com/Auxx-Ai/auxx-ai/issues/1199)) ([a5fe47a](https://github.com/Auxx-Ai/auxx-ai/commit/a5fe47aae0a0d5222333d36f1ebc8961cf5c3c8c))
* **view-config:** drive panel defaults from registry, stop seeding panel views ([#1213](https://github.com/Auxx-Ai/auxx-ai/issues/1213)) ([0b0cd3d](https://github.com/Auxx-Ai/auxx-ai/commit/0b0cd3d0457b07378fe73760676e11a3776dc755))


### Bug Fixes

* **dispatch:** improve event popover date/time layout and catalog picker scroll ([#1187](https://github.com/Auxx-Ai/auxx-ai/issues/1187)) ([9abd181](https://github.com/Auxx-Ai/auxx-ai/commit/9abd1811eef6f5a86d5c7777e54931089f09166a))
* **money:** net refunds out of deposit figures + land allocation verify harness ([#1193](https://github.com/Auxx-Ai/auxx-ai/issues/1193)) ([3451d2f](https://github.com/Auxx-Ai/auxx-ai/commit/3451d2f3fd8335745479aede0dc435d340b8e501))
* **records:** canonicalize RecordId prefixes across record/field-value/relationship caches ([#1198](https://github.com/Auxx-Ai/auxx-ai/issues/1198)) ([997c43c](https://github.com/Auxx-Ai/auxx-ai/commit/997c43c6bff19cbd0a58f07d0ad9d0f99b6bbb9c))
* **ui:** crossfade same-depth NavStack swaps via new 'replace' direction ([#1200](https://github.com/Auxx-Ai/auxx-ai/issues/1200)) ([d5c8ba8](https://github.com/Auxx-Ai/auxx-ai/commit/d5c8ba8c9dc18580a92ec7598b53683ab3d20ed3))


### Performance Improvements

* **availability:** batch resolve across subjects in one query set ([#1190](https://github.com/Auxx-Ai/auxx-ai/issues/1190)) ([9d336f1](https://github.com/Auxx-Ai/auxx-ai/commit/9d336f1bbde8e27bdee9f65f976751393f806f00))
* **realtime:** batch fieldValues:updated frames in setValuesForEntity ([#1204](https://github.com/Auxx-Ai/auxx-ai/issues/1204)) ([b6cd3dd](https://github.com/Auxx-Ai/auxx-ai/commit/b6cd3dd797d81f6b0b228ab0e20f618f5558e2b1))

## [0.1.182](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.181...auxx-v0.1.182) (2026-07-15)


### Features

* add sequence Visit placeholder formatting ([#1182](https://github.com/Auxx-Ai/auxx-ai/issues/1182)) ([0a4e8c0](https://github.com/Auxx-Ai/auxx-ai/commit/0a4e8c0e19a8076677f7ae811e591b697b4fa766))
* **blog:** AI skills series + covers for support/CRM guides ([#1117](https://github.com/Auxx-Ai/auxx-ai/issues/1117)) ([db57927](https://github.com/Auxx-Ai/auxx-ai/commit/db57927e7d680916a6ea336a46bc6a4f3ac416e1))
* **calendar:** source-registry layer + dispatch re-seat + meetings source ([#1149](https://github.com/Auxx-Ai/auxx-ai/issues/1149)) ([aa7f83b](https://github.com/Auxx-Ai/auxx-ai/commit/aa7f83b4a69ad2b3817b7d0e0d083274a6965b03))
* **channels:** unify channel reconnect + connect on useConnectFlow ([#1143](https://github.com/Auxx-Ai/auxx-ai/issues/1143)) ([19a17de](https://github.com/Auxx-Ai/auxx-ai/commit/19a17defc632ea1cd9b8b15c58a5bea0cd6e7e61))
* **dashboard:** add favorite/unfavorite toggle for dashboards ([#1111](https://github.com/Auxx-Ai/auxx-ai/issues/1111)) ([baa61af](https://github.com/Auxx-Ai/auxx-ai/commit/baa61afcc49ad7bd1a810a170a3046648be1a953))
* **dispatch,drawers:** shared schedule-visit-row + drawer record peek/deep-drill ([#1166](https://github.com/Auxx-Ai/auxx-ai/issues/1166)) ([4199ac7](https://github.com/Auxx-Ai/auxx-ai/commit/4199ac72127de9cd62ba2f0ca33e16d4a458d395))
* **dispatch,money:** visit time confirmation + durations, route drift badge, line grip restyle ([#1174](https://github.com/Auxx-Ai/auxx-ai/issues/1174)) ([4071614](https://github.com/Auxx-Ai/auxx-ai/commit/4071614a7b03c7394f41f7bebe376744008de098))
* **dispatch,sequences:** client notifications + signals + message triggers ([#1179](https://github.com/Auxx-Ai/auxx-ai/issues/1179)) ([516ee14](https://github.com/Auxx-Ai/auxx-ai/commit/516ee14c71d4a217e2f1ba5c226b15b5f2b49cc4))
* **dispatch,ui:** dockable event panel (Notion-Calendar-style side dock) ([#1175](https://github.com/Auxx-Ai/auxx-ai/issues/1175)) ([4f11712](https://github.com/Auxx-Ai/auxx-ai/commit/4f1171235c965ee6b09e90916b0e9f8e3692e6bc))
* **dispatch,ui:** shared record drill panels + drawer deep-drill to visits ([#1165](https://github.com/Auxx-Ai/auxx-ai/issues/1165)) ([91e8cca](https://github.com/Auxx-Ai/auxx-ai/commit/91e8cca4cb3024bccaf0dc66e09dda0b43481517))
* **dispatch/money:** availability org slice (M2-pre) + money MQ2 quote sending ([#1129](https://github.com/Auxx-Ai/auxx-ai/issues/1129)) ([6d99c73](https://github.com/Auxx-Ai/auxx-ai/commit/6d99c73c3038bde5f1c6f937115aa8e19d22abbc))
* **dispatch:** delete quality-check templates ([#1158](https://github.com/Auxx-Ai/auxx-ai/issues/1158)) ([fe6a598](https://github.com/Auxx-Ai/auxx-ai/commit/fe6a598484f2108d3b3d65a373b5387651a32205))
* **dispatch:** M1 records — work_order + service_request entities, visits, RecordSequence ([#1125](https://github.com/Auxx-Ai/auxx-ai/issues/1125)) ([212c347](https://github.com/Auxx-Ai/auxx-ai/commit/212c347c18a5cda7b37d69d2698dca946cbc32cc))
* **dispatch:** M2a board — calendar primitive, visit machinery, board UI, workers settings ([#1132](https://github.com/Auxx-Ai/auxx-ai/issues/1132)) ([d2c8cc5](https://github.com/Auxx-Ai/auxx-ai/commit/d2c8cc5e85a8c3440cb7b942fc09ad65151724b5))
* **dispatch:** M2b job view — sections mode, work_order detail page, quote flip ([#1133](https://github.com/Auxx-Ai/auxx-ai/issues/1133)) ([cf08387](https://github.com/Auxx-Ai/auxx-ai/commit/cf083873a25ea46518005ccc5c621b5ca1094602))
* **dispatch:** M2c recurring engine — recurrence core, rule storage, materializer, series UI ([#1134](https://github.com/Auxx-Ai/auxx-ai/issues/1134)) ([66281ee](https://github.com/Auxx-Ai/auxx-ai/commit/66281ee8f472fb71339b2e6eda41cca54fabbbe0))
* **dispatch:** render sequences from TipTap JSON ([#1183](https://github.com/Auxx-Ai/auxx-ai/issues/1183)) ([79430b2](https://github.com/Auxx-Ai/auxx-ai/commit/79430b269b81c3505911190a778a7bd21b828c6d))
* **dispatch:** resource timeline view + dispatcher proof-of-work checklist ([#1172](https://github.com/Auxx-Ai/auxx-ai/issues/1172)) ([4507ddd](https://github.com/Auxx-Ai/auxx-ai/commit/4507ddd4887d28bacb528c2d8dc39e616780e98d))
* **dispatch:** route planner M3 (map, geocoding, suggest, apply-times) + WS2 quality checklist ([#1142](https://github.com/Auxx-Ai/auxx-ai/issues/1142)) ([c58273a](https://github.com/Auxx-Ai/auxx-ai/commit/c58273a1c5d5f24132eb408a5f51b00df42796be))
* **dispatch:** route planner restyle + worker day-gating + engine hook fixes ([#1144](https://github.com/Auxx-Ai/auxx-ai/issues/1144)) ([ec8bdfc](https://github.com/Auxx-Ai/auxx-ai/commit/ec8bdfce365bcba4a877b4a42da726f53463d5c5))
* **dispatch:** route planner v4 polish — mapbox round trips, teardrop pins, record peek ([#1162](https://github.com/Auxx-Ai/auxx-ai/issues/1162)) ([89bc18c](https://github.com/Auxx-Ai/auxx-ai/commit/89bc18c2ae7869d3dc4369a281b26f584eee7e39))
* **dispatch:** route-times auto-sync setting (plan 20 phase 3) ([#1177](https://github.com/Auxx-Ai/auxx-ai/issues/1177)) ([d3c0d4f](https://github.com/Auxx-Ai/auxx-ai/commit/d3c0d4f9626972193d798804a862c21f3164716e))
* **dispatch:** schedule + visit popover on shared event-popover primitives ([#1157](https://github.com/Auxx-Ai/auxx-ai/issues/1157)) ([433064c](https://github.com/Auxx-Ai/auxx-ai/commit/433064ce9a12c2fedd7133ce87edeb93e4038e90))
* **dispatch:** sidebar routes group on shared item primitives + worker drop targets ([#1164](https://github.com/Auxx-Ai/auxx-ai/issues/1164)) ([74ff19c](https://github.com/Auxx-Ai/auxx-ai/commit/74ff19cd7ed3bdc53c07521c6f5e6fbfb8eb5ecf))
* **dispatch:** split repeat-row pill into short label + detail line ([#1160](https://github.com/Auxx-Ai/auxx-ai/issues/1160)) ([3cdc9c7](https://github.com/Auxx-Ai/auxx-ai/commit/3cdc9c75701aebe2c447dd7844cc792368e45bc9))
* **dispatch:** uniform drawer field defaults + request work-order/quote blocks ([#1140](https://github.com/Auxx-Ai/auxx-ai/issues/1140)) ([4813e7c](https://github.com/Auxx-Ai/auxx-ai/commit/4813e7c552555a2900a33ca1daf8d742edd8817f))
* **dispatch:** unify drag ghosts on shared AppDragOverlay ([#1159](https://github.com/Auxx-Ai/auxx-ai/issues/1159)) ([0882c43](https://github.com/Auxx-Ai/auxx-ai/commit/0882c43697f66db582546ebb91899818b11245d5))
* **dispatch:** v3 module sidebar + calendar event colors + availability cache ([#1145](https://github.com/Auxx-Ai/auxx-ai/issues/1145)) ([eb2afd8](https://github.com/Auxx-Ai/auxx-ai/commit/eb2afd8512addf89a3b89fb1bc347bfb1beaadcf))
* **dispatch:** visit drawer + work-order overview cards + virtualized month view ([#1141](https://github.com/Auxx-Ai/auxx-ai/issues/1141)) ([3d0e5e4](https://github.com/Auxx-Ai/auxx-ai/commit/3d0e5e4bc0d5cf88077a591285a0c333c56f60fb))
* **dispatch:** worker surface — schedule page + visit execution (WS1) ([#1138](https://github.com/Auxx-Ai/auxx-ai/issues/1138)) ([ee29c74](https://github.com/Auxx-Ai/auxx-ai/commit/ee29c749b071982eeb86285ddb09ff28c353d3fc))
* gate sequences behind feature flag ([#1185](https://github.com/Auxx-Ai/auxx-ai/issues/1185)) ([a82c6fe](https://github.com/Auxx-Ai/auxx-ai/commit/a82c6fe6e0e20c7566a2716cf66d05017ec9e3be))
* improve sequence settings drawer ([#1181](https://github.com/Auxx-Ai/auxx-ai/issues/1181)) ([fcdd9ff](https://github.com/Auxx-Ai/auxx-ai/commit/fcdd9ff6d9e27176858fe613a26a3b054a698c67))
* **kb:** add Knowledge Bases tab to /app/kb landing ([#1113](https://github.com/Auxx-Ai/auxx-ai/issues/1113)) ([208a1f0](https://github.com/Auxx-Ai/auxx-ai/commit/208a1f08fe62ed1e9e06d1a39be9fc77461693b4))
* **kbar:** contextual palette actions + page shortcuts for more surfaces ([#1115](https://github.com/Auxx-Ai/auxx-ai/issues/1115)) ([8b03127](https://github.com/Auxx-Ai/auxx-ai/commit/8b031278418b0c7f6aec5b4e68078d43cb03266d))
* **kb:** catalog-first knowledge retrieval — inject article ToC into agent prompts ([#1118](https://github.com/Auxx-Ai/auxx-ai/issues/1118)) ([1101476](https://github.com/Auxx-Ai/auxx-ai/commit/11014764847053d9b23e405bbd20df8cbbbe93e8))
* **kb:** interactive AI-memory write door — "remember this" in kopilot chat ([#1123](https://github.com/Auxx-Ai/auxx-ai/issues/1123)) ([141c410](https://github.com/Auxx-Ai/auxx-ai/commit/141c410734c8fe91ec7a2a31d34e6b9f68256908))
* **kb:** learned KB provisioning + upsert_learned_article tool ([#1119](https://github.com/Auxx-Ai/auxx-ai/issues/1119)) ([770b9c7](https://github.com/Auxx-Ai/auxx-ai/commit/770b9c70c39f7796abc364ad6244637874b47236))
* **kb:** learned-KB extraction pipeline — resolved threads become AI memory proposals ([#1122](https://github.com/Auxx-Ai/auxx-ai/issues/1122)) ([acd2caf](https://github.com/Auxx-Ai/auxx-ai/commit/acd2caf4461393618c0bf98627444f633aed25b1))
* **kb:** learned-memory management UX — entry card, trimmed editor, previews, force extraction ([#1124](https://github.com/Auxx-Ai/auxx-ai/issues/1124)) ([4d64007](https://github.com/Auxx-Ai/auxx-ai/commit/4d640074af1832d932d8c5bee756da2862a8efd5))
* **mail:** read/unread toggle, assignee polish, T for tags ([#1106](https://github.com/Auxx-Ai/auxx-ai/issues/1106)) ([89c18b2](https://github.com/Auxx-Ai/auxx-ai/commit/89c18b24f3ee9e76474e30ef1398c171e63a80ce))
* **money,dispatch,records:** tucked-label billing headers + open full page ([#1168](https://github.com/Auxx-Ai/auxx-ai/issues/1168)) ([81bcecb](https://github.com/Auxx-Ai/auxx-ai/commit/81bcecb7180786456955c23f0067abf36a0e0ed5))
* **money,dispatch:** public quote acceptance page + dispatch polish ([#1170](https://github.com/Auxx-Ai/auxx-ai/issues/1170)) ([d15290c](https://github.com/Auxx-Ai/auxx-ai/commit/d15290c20b99b0d47657f4df446ea7b862da29e1))
* **money,dispatch:** quote deposits + partial invoice payments + delete guards ([#1173](https://github.com/Auxx-Ai/auxx-ai/issues/1173)) ([a894579](https://github.com/Auxx-Ai/auxx-ai/commit/a894579ad692b24de5f751d746269fd06ba471e7))
* **money,records,drawers:** quote↔job linkage + root-level record editor ([#1171](https://github.com/Auxx-Ai/auxx-ai/issues/1171)) ([66f5411](https://github.com/Auxx-Ai/auxx-ai/commit/66f5411521c1614ef2bebaae532bbb5a7f28ef9c))
* **money:** invoice automation (MI2) — auto-draft engine, billing schedule, org invoicing settings ([#1136](https://github.com/Auxx-Ai/auxx-ai/issues/1136)) ([85836a7](https://github.com/Auxx-Ai/auxx-ai/commit/85836a71f9061a55a41f7c68d91e7fe7904bdb97))
* **money:** line-builder rewrite + instant catalog append ([#1152](https://github.com/Auxx-Ai/auxx-ai/issues/1152)) ([5654950](https://github.com/Auxx-Ai/auxx-ai/commit/5654950efbae6380fe8059145f1c45602d08c00c))
* **money:** MI1 invoicing — invoice/payment entities, PaymentTransaction ledger, gather flow, invoice PDF+send ([#1130](https://github.com/Auxx-Ai/auxx-ai/issues/1130)) ([bab2c52](https://github.com/Auxx-Ai/auxx-ai/commit/bab2c52e8f299d0b623022a59c80fb743986db4b))
* **money:** MP1 payment collection — hosted-provision connection type + Stripe Connect ([#1131](https://github.com/Auxx-Ai/auxx-ai/issues/1131)) ([7d1e578](https://github.com/Auxx-Ai/auxx-ai/commit/7d1e57838c21134f6a0534ba5cd6939fc05c8ec2))
* **money:** MQ1 quoting — quote/line-item/catalog entities, totals engine, quote UI, dispatch nav ([#1126](https://github.com/Auxx-Ai/auxx-ai/issues/1126)) ([e77294e](https://github.com/Auxx-Ai/auxx-ai/commit/e77294e1681518393bd156512fce6f2c6e6d12d4))
* **money:** product groups — catalog bundles with picker explode (plan 09) ([#1150](https://github.com/Auxx-Ai/auxx-ai/issues/1150)) ([1854116](https://github.com/Auxx-Ai/auxx-ai/commit/185411637b57b5dd8bfb23c06ccc35366b6b72ca))
* **money:** products & services catalog editor rewrite ([#1156](https://github.com/Auxx-Ai/auxx-ai/issues/1156)) ([f097a5c](https://github.com/Auxx-Ai/auxx-ai/commit/f097a5c7ad9ffd7721b728ce5b0d2ff1e0bb7f63))
* **money:** quote drawer lines overview card, line-builder refactor, realtime publish-key fix ([#1137](https://github.com/Auxx-Ai/auxx-ai/issues/1137)) ([e837439](https://github.com/Auxx-Ai/auxx-ai/commit/e837439bb5e137bd20cac6eb5ab6c2b9d82b503f))
* **money:** work-order billing section (invoices + payments on the job view) ([#1161](https://github.com/Auxx-Ai/auxx-ai/issues/1161)) ([9cf1775](https://github.com/Auxx-Ai/auxx-ai/commit/9cf1775ec6606f5c47c3cdf715ff32706f7b8d22))
* **records,money,ui:** record-editor registry + line-builder keyboard nav + shared TreeRowList ([#1167](https://github.com/Auxx-Ai/auxx-ai/issues/1167)) ([3ea9a39](https://github.com/Auxx-Ai/auxx-ai/commit/3ea9a394d403e1d6449db87bccaa39b05f1d7077))
* **records:** calendar as third table view type ([#1153](https://github.com/Auxx-Ai/auxx-ai/issues/1153)) ([6fd80d2](https://github.com/Auxx-Ai/auxx-ai/commit/6fd80d202ba13a4bbdcfd8cc5457a73b841db4ba))
* **schedule:** calendar view on /app/schedule + week-view day stream ([#1151](https://github.com/Auxx-Ai/auxx-ai/issues/1151)) ([2a9e957](https://github.com/Auxx-Ai/auxx-ai/commit/2a9e957a82b809b6657444b41b4583c84f0048bc))
* **sequences:** outbound email cadences on system-workflow model ([#1169](https://github.com/Auxx-Ai/auxx-ai/issues/1169)) ([e6d69a7](https://github.com/Auxx-Ai/auxx-ai/commit/e6d69a77e538971fb84bdf7d295bdeaebac9888b))
* **settings:** settings v2 on FieldTypes — catalog-driven service + money cents fix ([#1128](https://github.com/Auxx-Ai/auxx-ai/issues/1128)) ([d92dc56](https://github.com/Auxx-Ai/auxx-ai/commit/d92dc56f88038c1ca8211a758013bd5cc36518ce))
* **settings:** unify money + dispatch settings UI polish ([#1155](https://github.com/Auxx-Ai/auxx-ai/issues/1155)) ([be92d9a](https://github.com/Auxx-Ai/auxx-ai/commit/be92d9ab59edec44ca12cb085f82396bc9edb31c))
* **settings:** unify settings forms on a shared save-bar + dirty-draft ([#1139](https://github.com/Auxx-Ai/auxx-ai/issues/1139)) ([70f8b39](https://github.com/Auxx-Ai/auxx-ai/commit/70f8b39c7b28e81f445adf9b9670f4945ed83455))
* **sidebar:** unify rows onto lean SidebarItem + SidebarNavItem ([#1148](https://github.com/Auxx-Ai/auxx-ai/issues/1148)) ([64052f8](https://github.com/Auxx-Ai/auxx-ai/commit/64052f876fc0ed101c641de4994ad8247e60eddd))
* **ui,dispatch:** event-calendar resize + dock/popover polish ([#1178](https://github.com/Auxx-Ai/auxx-ai/issues/1178)) ([a5c5bba](https://github.com/Auxx-Ai/auxx-ai/commit/a5c5bba6228cff7fc54df994855773b80cdc9848))
* **ui:** event-calendar selection ring + Notion tick-grid + drag polish ([#1154](https://github.com/Auxx-Ai/auxx-ai/issues/1154)) ([d1c3532](https://github.com/Auxx-Ai/auxx-ai/commit/d1c353271fc6ff6e67319c53d41fa0e750113c49))
* **ui:** fixedWeeks for stable calendar height ([#1147](https://github.com/Auxx-Ai/auxx-ai/issues/1147)) ([770861f](https://github.com/Auxx-Ai/auxx-ai/commit/770861fc679282d24b87d56243682574eda732ee))
* **ui:** in-house calendar component + dispatch store relocation ([#1146](https://github.com/Auxx-Ai/auxx-ai/issues/1146)) ([57043f3](https://github.com/Auxx-Ai/auxx-ai/commit/57043f3b4bb714f54419d4873c49342bf4c9ee83))
* **workflow:** create manual-trigger workflow pre-wired to a resource ([#1110](https://github.com/Auxx-Ai/auxx-ai/issues/1110)) ([8f236b1](https://github.com/Auxx-Ai/auxx-ai/commit/8f236b178859c51eb29bfa1674f81aaf1faece3d))


### Bug Fixes

* **dispatch,ui:** calendar padding polish + worker profile field adapters ([#1163](https://github.com/Auxx-Ai/auxx-ai/issues/1163)) ([a2647c5](https://github.com/Auxx-Ai/auxx-ai/commit/a2647c5d8fb3624d3868b80fa8a76445fc6ed1a9))
* **dispatch:** improve visit detail and line drafts ([#1184](https://github.com/Auxx-Ai/auxx-ai/issues/1184)) ([d9da71c](https://github.com/Auxx-Ai/auxx-ai/commit/d9da71c4d68fffd180208b4e686badb1b4f1c76f))
* **drawer:** scope contact conversations tab highlight + tab order ([#1120](https://github.com/Auxx-Ai/auxx-ai/issues/1120)) ([48b4505](https://github.com/Auxx-Ai/auxx-ai/commit/48b4505b2dca01555308808a26e675b186d77d2c))
* **favorites:** keep sidebar favorites removable in every state ([#1114](https://github.com/Auxx-Ai/auxx-ai/issues/1114)) ([158524b](https://github.com/Auxx-Ai/auxx-ai/commit/158524bbe69677ba2ebe0d6627d087a181e3f966))
* **kbd:** render meta-key icon via CSS instead of JS platform check ([#1108](https://github.com/Auxx-Ai/auxx-ai/issues/1108)) ([3054947](https://github.com/Auxx-Ai/auxx-ai/commit/30549474d9d49bdd809966e1df1b6915447ef73d))
* **kb:** improve knowledge search retrieval quality ([#1116](https://github.com/Auxx-Ai/auxx-ai/issues/1116)) ([9fab74f](https://github.com/Auxx-Ai/auxx-ai/commit/9fab74f775816e6a208e7d69bee84825d497a845))
* MQ1 verify script rounding/default fixes + contact-hooks email normalization ([#1135](https://github.com/Auxx-Ai/auxx-ai/issues/1135)) ([701ac7a](https://github.com/Auxx-Ai/auxx-ai/commit/701ac7a100bd6f486e67817a6943f414c972a2c8))
* **seed:** resolve kanban view-config keys to bare field ids ([#1127](https://github.com/Auxx-Ai/auxx-ai/issues/1127)) ([71255cd](https://github.com/Auxx-Ai/auxx-ai/commit/71255cd1725454df33fba22fadfdfca2e37e28d7))


### Performance Improvements

* **dispatch:** reduce board query traffic ([#1180](https://github.com/Auxx-Ai/auxx-ai/issues/1180)) ([fe2e8fd](https://github.com/Auxx-Ai/auxx-ai/commit/fe2e8fdebf18cc74bb4254995d5c3fc2580a1dfc))

## [0.1.181](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.180...auxx-v0.1.181) (2026-07-09)


### Features

* **files:** render ICO & SVG logos via canonical image normalization ([#1102](https://github.com/Auxx-Ai/auxx-ai/issues/1102)) ([c6d4442](https://github.com/Auxx-Ai/auxx-ai/commit/c6d44423e9c636e32996def8cc6c11d06d8abd84))
* **mail:** bidirectional Gmail status & read-state sync for personal inboxes ([#1104](https://github.com/Auxx-Ai/auxx-ai/issues/1104)) ([8c935f9](https://github.com/Auxx-Ai/auxx-ai/commit/8c935f99901684a2e1bd8fb0ec94f1dcea0dbc9a))
* **mail:** personal-inbox Gmail parity — label status, names, Sent group, thread contact ([#1103](https://github.com/Auxx-Ai/auxx-ai/issues/1103)) ([1e95d6a](https://github.com/Auxx-Ai/auxx-ai/commit/1e95d6a9b1b858d734322323b2562b94d8d3d591))
* **mail:** regroup personal inboxes under Inbox with isolation rules ([#1100](https://github.com/Auxx-Ai/auxx-ai/issues/1100)) ([3fd3da7](https://github.com/Auxx-Ai/auxx-ai/commit/3fd3da7bd9718f111ed88c16a33d598bebdb22da))


### Bug Fixes

* **files:** sniff remote image types + soft-skip unsupported thumbnails; raise Gmail sync limits ([#1098](https://github.com/Auxx-Ai/auxx-ai/issues/1098)) ([0959ed8](https://github.com/Auxx-Ai/auxx-ai/commit/0959ed8b856e781f289758294768b492f9a7829c))
* **mail:** keyboard shortcuts target the open thread in detail view ([#1101](https://github.com/Auxx-Ai/auxx-ai/issues/1101)) ([a0b904a](https://github.com/Auxx-Ai/auxx-ai/commit/a0b904aa6c8fc36450bd20f38f60ef145bb4ccf7))

## [0.1.180](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.179...auxx-v0.1.180) (2026-07-09)


### Features

* **workflow:** gate AI-node options on model capabilities + per-node trace renderers ([#1095](https://github.com/Auxx-Ai/auxx-ai/issues/1095)) ([cf1da6d](https://github.com/Auxx-Ai/auxx-ai/commit/cf1da6d7aecc4872896afb86ed00ef357e7b803b))
* **workflow:** historical-run node Results, run deep-linking, truthful branch status ([#1096](https://github.com/Auxx-Ai/auxx-ai/issues/1096)) ([90c67f8](https://github.com/Auxx-Ai/auxx-ai/commit/90c67f88aabed3be74b8e8a80bd267264eae2ce8))
* **workflow:** shopify-order-lookup order-not-found branch + reply gating ([#1097](https://github.com/Auxx-Ai/auxx-ai/issues/1097)) ([f4b9701](https://github.com/Auxx-Ai/auxx-ai/commit/f4b9701d5e2e4efddd4f87ad3b04bb5fe1add8ff))


### Bug Fixes

* **homepage:** readable text over gradient cards in light mode ([#1093](https://github.com/Auxx-Ai/auxx-ai/issues/1093)) ([e4c507e](https://github.com/Auxx-Ai/auxx-ai/commit/e4c507e472d29af1ac878aefbc756d786451e2e3))

## [0.1.179](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.178...auxx-v0.1.179) (2026-07-08)


### Features

* **homepage:** add Data Connectors marketing section ([#1091](https://github.com/Auxx-Ai/auxx-ai/issues/1091)) ([3a5a553](https://github.com/Auxx-Ai/auxx-ai/commit/3a5a5538a40cf2a8e5663b341c1083f2d9b894a0))
* **homepage:** redesign CRM hero + add dashboards section ([#1089](https://github.com/Auxx-Ai/auxx-ai/issues/1089)) ([7a0912c](https://github.com/Auxx-Ai/auxx-ai/commit/7a0912c8bc7e47321dfcbc7e65dc424bdf06d3a3))
* **workflow:** per-node trace renderers + shopify-review seed scenario ([#1092](https://github.com/Auxx-Ai/auxx-ai/issues/1092)) ([797f37c](https://github.com/Auxx-Ai/auxx-ai/commit/797f37c422b3b10d65622ce5ab48d41331de290c))

## [0.1.178](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.177...auxx-v0.1.178) (2026-07-08)


### Features

* **dashboards:** chart color schemes, record-list columns manager, shared TabStrip/RenameInput ([#1082](https://github.com/Auxx-Ai/auxx-ai/issues/1082)) ([72355a9](https://github.com/Auxx-Ai/auxx-ai/commit/72355a911d4818db9c0d1893106b18674b2dbbaa))
* **dashboards:** config field renames + inline help, paginated legend carousel ([#1083](https://github.com/Auxx-Ai/auxx-ai/issues/1083)) ([e00ed69](https://github.com/Auxx-Ai/auxx-ai/commit/e00ed69c103b0cea031d7cd752921377b04bb933))
* **dashboards:** dashboards feature with widgets, aggregate engine, and versioning ([#1077](https://github.com/Auxx-Ai/auxx-ai/issues/1077)) ([6deae82](https://github.com/Auxx-Ai/auxx-ai/commit/6deae82542cac28141655fbd077cc36b6c65bfa9))
* **dashboards:** display formatting — value + date-axis overrides ([#1080](https://github.com/Auxx-Ai/auxx-ai/issues/1080)) ([845374a](https://github.com/Auxx-Ai/auxx-ai/commit/845374ad62561cd52fea29e0338832682db5c257))
* **dashboards:** gate record drawer fullscreen by detail-page support ([#1087](https://github.com/Auxx-Ai/auxx-ai/issues/1087)) ([3497609](https://github.com/Auxx-Ai/auxx-ai/commit/3497609d29cbb583a7c95dfc63fd7fc2e17953c7))
* **dashboards:** render record-list widget on DynamicTable (reduced mode) ([#1081](https://github.com/Auxx-Ai/auxx-ai/issues/1081)) ([5cceeab](https://github.com/Auxx-Ai/auxx-ai/commit/5cceeabb76dd794aa2bdcc5434a6808dc4447809))
* **dashboards:** server-side aggregate result cache (60s TTL) ([#1085](https://github.com/Auxx-Ai/auxx-ai/issues/1085)) ([3360d50](https://github.com/Auxx-Ai/auxx-ai/commit/3360d5052c7fd00ed32472130ee15ef792f3b315))
* **dashboards:** switch versioning to agent model (row-as-draft) ([#1079](https://github.com/Auxx-Ai/auxx-ai/issues/1079)) ([924550d](https://github.com/Auxx-Ai/auxx-ai/commit/924550dc92d06730f29060073da71d056a83e342))
* **homepage:** reporting platform page + nav tweaks ([#1088](https://github.com/Auxx-Ai/auxx-ai/issues/1088)) ([9059e5f](https://github.com/Auxx-Ai/auxx-ai/commit/9059e5fed803240249ec00535477ff7dad49e888))
* **startups:** startup discount program + /startups landing page ([#1086](https://github.com/Auxx-Ai/auxx-ai/issues/1086)) ([f4eb8e6](https://github.com/Auxx-Ai/auxx-ai/commit/f4eb8e6f473bbe863f099350ba88acad138f6a4e))

## [0.1.177](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.176...auxx-v0.1.177) (2026-07-07)


### Features

* **parts:** definition-icon fallback in relation pickers + system TAGS options ([#1075](https://github.com/Auxx-Ai/auxx-ai/issues/1075)) ([220be54](https://github.com/Auxx-Ai/auxx-ai/commit/220be547221223e29fb9761bbf1001b300240dde))
* **parts:** parts v2 + inbox/channel UI refinements ([#1073](https://github.com/Auxx-Ai/auxx-ai/issues/1073)) ([8c6e8af](https://github.com/Auxx-Ai/auxx-ai/commit/8c6e8af7220fe5f3f0decab0a7b2359b305e0d79))

## [0.1.176](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.175...auxx-v0.1.176) (2026-07-07)


### Features

* **channels:** channels v2 UI + member-safe settings ([#1071](https://github.com/Auxx-Ai/auxx-ai/issues/1071)) ([dd25017](https://github.com/Auxx-Ai/auxx-ai/commit/dd250178be9e1dd1c6324cfbd068294c6d76ec65))
* **inbox:** settings management + unified grantee list ([#1072](https://github.com/Auxx-Ai/auxx-ai/issues/1072)) ([8dd4140](https://github.com/Auxx-Ai/auxx-ai/commit/8dd414076b009b216b9a6b79e3dcae7d0aefaeff))
* **mail:** automation-system visibility context (phase 7) ([#1069](https://github.com/Auxx-Ai/auxx-ai/issues/1069)) ([dbd9f06](https://github.com/Auxx-Ai/auxx-ai/commit/dbd9f06e94a61bc46075fda7354fbaed9dcc04d2))
* **mail:** enterprise gate, inbox access UI, sharing surfaces, redacted rendering (phases 4-5) ([#1067](https://github.com/Auxx-Ai/auxx-ai/issues/1067)) ([4cb374d](https://github.com/Auxx-Ai/auxx-ai/commit/4cb374d93a5084c06140c17a78e8353f93d411a6))
* **mail:** lens-based mail visibility enforcement (phases 0-2) ([#1064](https://github.com/Auxx-Ai/auxx-ai/issues/1064)) ([e5d95a2](https://github.com/Auxx-Ai/auxx-ai/commit/e5d95a2bc7abc2e14c138b7c426dfa61475c0fe6))
* **mail:** personal email accounts (phase 8) ([#1070](https://github.com/Auxx-Ai/auxx-ai/issues/1070)) ([d49866d](https://github.com/Auxx-Ai/auxx-ai/commit/d49866dfcff1d3bd0e38363256e4e6315fcbd777))
* **mail:** phase 6 hardening — retire inbox_visibility, audits, dead code ([#1068](https://github.com/Auxx-Ai/auxx-ai/issues/1068)) ([d079902](https://github.com/Auxx-Ai/auxx-ai/commit/d07990294abbea41767f1d39601038043d88b6a4))
* **mail:** realtime per-lens channels (phase 3) ([#1066](https://github.com/Auxx-Ai/auxx-ai/issues/1066)) ([541b8d1](https://github.com/Auxx-Ai/auxx-ai/commit/541b8d1b3025ba8786fa7e876a07e1b78476f5a4))

## [0.1.175](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.174...auxx-v0.1.175) (2026-07-06)


### Performance Improvements

* **auth:** memoize session lookups and cache auth User rows ([#1057](https://github.com/Auxx-Ai/auxx-ai/issues/1057)) ([3519e6c](https://github.com/Auxx-Ai/auxx-ai/commit/3519e6cd130fd9a850ff261184f657f69a7bd18d))
* batch usage-event writes and cache hot reads (embeddings, quota, groups, connection defs) ([#1061](https://github.com/Auxx-Ai/auxx-ai/issues/1061)) ([c7bf757](https://github.com/Auxx-Ai/auxx-ai/commit/c7bf75773f64f51ea5a8d309868033437c94a826))
* cut scanner scans, hot-path logging, and setup-path round-trips (Phase 5) ([#1062](https://github.com/Auxx-Ai/auxx-ai/issues/1062)) ([034cdf5](https://github.com/Auxx-Ai/auxx-ai/commit/034cdf5c4239f8eccbe3557412db4e21aaf60db2))
* **mail:** serve sidebar thread counts from delta-maintained Redis counters ([#1063](https://github.com/Auxx-Ai/auxx-ai/issues/1063)) ([b5d14db](https://github.com/Auxx-Ai/auxx-ai/commit/b5d14dbed0f66e3ee6879dfe135479a4c47a7cc5))
* reduce hot-path SQL via batching, projections, and org-cache reads ([#1059](https://github.com/Auxx-Ai/auxx-ai/issues/1059)) ([2ec6769](https://github.com/Auxx-Ai/auxx-ai/commit/2ec6769818cc2cdd2327f27bcb5ebc17527dea95))
* **worker:** raise event throughput and cut ingest/event-path round-trips ([#1060](https://github.com/Auxx-Ai/auxx-ai/issues/1060)) ([669070a](https://github.com/Auxx-Ai/auxx-ai/commit/669070a47a73c0799dd0a7418c8ba70e0837faba))

## [0.1.174](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.173...auxx-v0.1.174) (2026-07-03)


### Features

* **inventory-bridge:** fold linked sources into part inventory card ([#1053](https://github.com/Auxx-Ai/auxx-ai/issues/1053)) ([6c6108f](https://github.com/Auxx-Ai/auxx-ai/commit/6c6108f68401213b1478a33bd4d5ca870f733d59))


### Bug Fixes

* **custom-fields:** persist CALC option edits and compute calc cells without a source-value arrival ([#1055](https://github.com/Auxx-Ai/auxx-ai/issues/1055)) ([8da512b](https://github.com/Auxx-Ai/auxx-ai/commit/8da512be5370883e104b20c0d821ab63c7d8ab21))

## [0.1.173](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.172...auxx-v0.1.173) (2026-07-02)


### Features

* **apps:** reconcile app fields at connector sync (create/drift/orphan) ([#1034](https://github.com/Auxx-Ai/auxx-ai/issues/1034)) ([c8680c5](https://github.com/Auxx-Ai/auxx-ai/commit/c8680c51f7864acb6a37d3d5cc9124e6cfc159a5))
* **data-connectors:** app icons + connector descriptions in source picker ([#1046](https://github.com/Auxx-Ai/auxx-ai/issues/1046)) ([9996e50](https://github.com/Auxx-Ai/auxx-ai/commit/9996e507d9bf007f42276c46d767b9d6c2e4ed2a))
* **data-connectors:** app-connector webhook summaries; vendor-part FieldInputAdapter ([#1041](https://github.com/Auxx-Ai/auxx-ai/issues/1041)) ([2f0866b](https://github.com/Auxx-Ai/auxx-ai/commit/2f0866b07ad243e71a1c5123d19140056ce48ecb))
* **data-connectors:** inventory→part bridge, webhook sweep fix, debounce coalescing ([#1038](https://github.com/Auxx-Ai/auxx-ai/issues/1038)) ([b531429](https://github.com/Auxx-Ai/auxx-ai/commit/b531429d25bae90564ba17d48ff90a9db4c044bd))
* **data-connectors:** managed inventory deduction record rule (v9) ([#1048](https://github.com/Auxx-Ai/auxx-ai/issues/1048)) ([de36918](https://github.com/Auxx-Ai/auxx-ai/commit/de36918ebbbedfb1c8136f3ad187e8c96ad76fb8))
* **inventory-bridge:** part-side inventory source link rows ([#1051](https://github.com/Auxx-Ai/auxx-ai/issues/1051)) ([b186520](https://github.com/Auxx-Ai/auxx-ai/commit/b186520a2931c00928b7c69fdfe9b3d429189168))
* **pickers:** unified ResourceFieldPicker (resource → field drill-down) ([#1047](https://github.com/Auxx-Ai/auxx-ai/issues/1047)) ([9b6b11c](https://github.com/Auxx-Ai/auxx-ai/commit/9b6b11ce5ad98b72d27bf0117c4ac2c103f3706c))
* **record-rules:** add dynamic field rules engine ([#1042](https://github.com/Auxx-Ai/auxx-ai/issues/1042)) ([8bc172f](https://github.com/Auxx-Ai/auxx-ai/commit/8bc172f03c47e9edacef0957083ded836c56686c))
* **record-rules:** redesign settings dialog with FieldPanel + DialogNav ([#1043](https://github.com/Auxx-Ai/auxx-ai/issues/1043)) ([b17c761](https://github.com/Auxx-Ai/auxx-ai/commit/b17c7618c859956c80591e399edbd921e3c340ea))
* **record-rules:** sync manifest engine, field-hook unification, run retention ([#1044](https://github.com/Auxx-Ai/auxx-ai/issues/1044)) ([db266de](https://github.com/Auxx-Ai/auxx-ai/commit/db266ded1cd23862d7e04aeb2457825f9555fd0d))
* **shopify:** multi-store Part 1 — fix App Store claim + admin unlink billing ([#1052](https://github.com/Auxx-Ai/auxx-ai/issues/1052)) ([6334282](https://github.com/Auxx-Ai/auxx-ai/commit/63342826a649521a6e07f72feb2706a7fdc57802))
* **subscription:** skip billing address + payment collection for free plans ([#1049](https://github.com/Auxx-Ai/auxx-ai/issues/1049)) ([4dd4762](https://github.com/Auxx-Ai/auxx-ai/commit/4dd4762de5a26083661b47dd92cc92fe499fd34f))


### Bug Fixes

* **data-connectors:** pin sample review banner under tabs strip ([#1036](https://github.com/Auxx-Ai/auxx-ai/issues/1036)) ([b375c24](https://github.com/Auxx-Ai/auxx-ai/commit/b375c24666510ceab73d9f09c48bf01adb8adcad))
* **data-connectors:** scope app-field reconciler to manifest fields; move provisioning to lib ([#1040](https://github.com/Auxx-Ai/auxx-ai/issues/1040)) ([d0ff37a](https://github.com/Auxx-Ai/auxx-ai/commit/d0ff37a190bc77cbdd227a7d0cbb253b85979ed0))
* **realtime:** serve notification sounds + unify on new-message cue ([#1050](https://github.com/Auxx-Ai/auxx-ai/issues/1050)) ([49d81aa](https://github.com/Auxx-Ai/auxx-ai/commit/49d81aaa76cf936e84e73e06284f2c71cd76d1d8))

## [0.1.172](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.171...auxx-v0.1.172) (2026-07-01)


### Features

* **health:** queue admin controls + DC identity fix + chat release CI ([#1031](https://github.com/Auxx-Ai/auxx-ai/issues/1031)) ([42722e2](https://github.com/Auxx-Ai/auxx-ai/commit/42722e29b99151e16b9f46198aef796e3e601609))


### Bug Fixes

* **apps:** mark app About page as client to fix Tooltip crash ([#1033](https://github.com/Auxx-Ai/auxx-ai/issues/1033)) ([5c978f9](https://github.com/Auxx-Ai/auxx-ai/commit/5c978f98e06fa5906b25bf905e6675c33bb28355))

## [0.1.171](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.170...auxx-v0.1.171) (2026-07-01)


### Features

* **custom-fields:** render URL fields as image thumbnails + connector avatar field wiring ([#1009](https://github.com/Auxx-Ai/auxx-ai/issues/1009)) ([c177884](https://github.com/Auxx-Ai/auxx-ai/commit/c177884ddff6b5035b5ab6c25a32ad0d627b18c0))
* **data-connectors:** connector-declared External ID on owned defs ([#1022](https://github.com/Auxx-Ai/auxx-ai/issues/1022)) ([4093321](https://github.com/Auxx-Ai/auxx-ai/commit/40933216293ffbefd4515c83502041b491d6c477))
* **data-connectors:** fix [@app](https://github.com/app): owned-def field resolution + surface dropped fields ([#1019](https://github.com/Auxx-Ai/auxx-ai/issues/1019)) ([4c6b122](https://github.com/Auxx-Ai/auxx-ai/commit/4c6b122ab616b17a34d8f901d72154be1089b4a5))
* **data-connectors:** lazy owned-def provisioning + potential-entity display ([#1002](https://github.com/Auxx-Ai/auxx-ai/issues/1002)) ([5ee07eb](https://github.com/Auxx-Ai/auxx-ai/commit/5ee07ebccfc9f5ac5fb87dc4c7275857c04ff717))
* **data-connectors:** multi-stream app-connector setup ([#987](https://github.com/Auxx-Ai/auxx-ai/issues/987)) ([9103ee5](https://github.com/Auxx-Ai/auxx-ai/commit/9103ee5e52697b2a2a767637effb0368bc0c33ed))
* **data-connectors:** owned relationship provisioning + record source badge ([#997](https://github.com/Auxx-Ai/auxx-ai/issues/997)) ([8537523](https://github.com/Auxx-Ai/auxx-ai/commit/853752302ed7dc6361b62a613c306b2e17878ec3))
* **data-connectors:** rebuild source picker on shared template gallery ([#1015](https://github.com/Auxx-Ai/auxx-ai/issues/1015)) ([cdb85e9](https://github.com/Auxx-Ai/auxx-ai/commit/cdb85e96645f4db5a8ebebf124d7e06b6abececc))
* **data-connectors:** select/address field provisioning + nested rel parenting + sync UI polish ([#1008](https://github.com/Auxx-Ai/auxx-ai/issues/1008)) ([3be936b](https://github.com/Auxx-Ai/auxx-ai/commit/3be936bf7bef2015ee901a4fa2e2b3bb02bf9483))
* **data-connectors:** share one entity definition across connectors + delete-safety ([#1024](https://github.com/Auxx-Ai/auxx-ai/issues/1024)) ([be73ceb](https://github.com/Auxx-Ai/auxx-ai/commit/be73cebf99fd997677777fea13af07365114d101))
* **data-connectors:** use declared requiresConnection for Connect + auto-link sole connection ([#1021](https://github.com/Auxx-Ai/auxx-ai/issues/1021)) ([f13d182](https://github.com/Auxx-Ai/auxx-ai/commit/f13d182dd313fd75968ba00c5b6c0391036001c4))
* **data-connectors:** v6 late-bound [@app](https://github.com/app) refs + delete projection layer (P5-6) ([#1016](https://github.com/Auxx-Ai/auxx-ai/issues/1016)) ([ae4a5a6](https://github.com/Auxx-Ai/auxx-ai/commit/ae4a5a62eaceb83fe01aee434cfdc98b37745634))
* **data-connectors:** v6 sourceKey identity + app record-types as templates (P1-4) ([#1013](https://github.com/Auxx-Ai/auxx-ai/issues/1013)) ([99bd6fb](https://github.com/Auxx-Ai/auxx-ai/commit/99bd6fb713a279dfd1b77f367a04bebe38e38854))
* **data-connectors:** zero-config name-match auto-binder for contributing mappings ([#996](https://github.com/Auxx-Ai/auxx-ai/issues/996)) ([77d2b2c](https://github.com/Auxx-Ai/auxx-ai/commit/77d2b2cb8c0b356b113faebc184b81d94dba8dd3))
* **database:** add ONBOARDING value to SettingScope enum ([#990](https://github.com/Auxx-Ai/auxx-ai/issues/990)) ([d983cf8](https://github.com/Auxx-Ai/auxx-ai/commit/d983cf8ab46d0e36db1b31a8b197d21518fead5b))
* **entity-definitions:** hard-delete with relationship + connector teardown ([#1003](https://github.com/Auxx-Ai/auxx-ai/issues/1003)) ([564b174](https://github.com/Auxx-Ai/auxx-ai/commit/564b174d179fe1595bc7708dc3b1485bdcaa2252))
* **export:** entity records → CSV via background job + realtime progress ([#1027](https://github.com/Auxx-Ai/auxx-ai/issues/1027)) ([f568032](https://github.com/Auxx-Ai/auxx-ai/commit/f568032a9f2bb86da80f34a25f82be22b353010f))
* **getting-started:** action + Learn more buttons in checklist hovercard ([#995](https://github.com/Auxx-Ai/auxx-ai/issues/995)) ([3c92425](https://github.com/Auxx-Ai/auxx-ai/commit/3c92425797293c6c2dff7a5bc2bb7aa99aed75e8))
* **getting-started:** onboarding checklist in the sidebar footer ([#994](https://github.com/Auxx-Ai/auxx-ai/issues/994)) ([a55d324](https://github.com/Auxx-Ai/auxx-ai/commit/a55d324a4eb98759b548e1ff2fdede76215784c1))
* **identity:** add RecordIdentity index + write-ownership rule (Phases 1-2) ([#1025](https://github.com/Auxx-Ai/auxx-ai/issues/1025)) ([fec71c9](https://github.com/Auxx-Ai/auxx-ai/commit/fec71c99f5cea920365f61b0e15bfdaddef7b1f8))
* **identity:** connector + chat converge on RecordIdentity index (Phases 3-5) ([#1026](https://github.com/Auxx-Ai/auxx-ai/issues/1026)) ([d837cb1](https://github.com/Auxx-Ai/auxx-ai/commit/d837cb190da152abc92fa397066441e4744d7981))
* **identity:** retire single-source EntityInstance columns for RecordIdentity index (Phase 6) ([#1028](https://github.com/Auxx-Ai/auxx-ai/issues/1028)) ([4a41b69](https://github.com/Auxx-Ai/auxx-ai/commit/4a41b69674692b9ebe9621cbc4649cd3fac49486))
* **kopilot:** records-page tools to list, update, and default table views ([#1001](https://github.com/Auxx-Ai/auxx-ai/issues/1001)) ([9118543](https://github.com/Auxx-Ai/auxx-ai/commit/9118543fd47041b096f29cccfb4521d3cd02c56c))
* **kopilot:** records-page tools to preview + save table views ([#998](https://github.com/Auxx-Ai/auxx-ai/issues/998)) ([ba31d37](https://github.com/Auxx-Ai/auxx-ai/commit/ba31d37f8b88f2f513d4c1d281d06ed9270fb88c))
* **realtime:** broadcast resource:created/updated/deleted on entity-def changes ([#1011](https://github.com/Auxx-Ai/auxx-ai/issues/1011)) ([863dd85](https://github.com/Auxx-Ai/auxx-ai/commit/863dd8568afc01efabbb9eb441b84325b5c283b0))
* **records-sidebar:** org-wide folders for entity definitions ([#1012](https://github.com/Auxx-Ai/auxx-ai/issues/1012)) ([350ea7b](https://github.com/Auxx-Ai/auxx-ai/commit/350ea7ba3c6428651a1a665ab2df6cd58afddb1d))
* **sidebar:** connector-sync badge on connector-owned record types ([#1018](https://github.com/Auxx-Ai/auxx-ai/issues/1018)) ([187f89e](https://github.com/Auxx-Ai/auxx-ai/commit/187f89ecc25c9ac8592a1e89fabbdfdf8ac3d53d))
* **sidebar:** make connector-sync badge link to its connector ([#1023](https://github.com/Auxx-Ai/auxx-ai/issues/1023)) ([6fa7660](https://github.com/Auxx-Ai/auxx-ai/commit/6fa766010016c4dcacb6ccf6c843a347e5238e1b))
* **ui:** bulk select + delete/archive for list-card grids ([#1014](https://github.com/Auxx-Ai/auxx-ai/issues/1014)) ([8cb9365](https://github.com/Auxx-Ai/auxx-ai/commit/8cb93659104a19d116bf6aedab206b09b2a5b4df))
* **webhooks:** inbound endpoint templates + topic catalog ([#1017](https://github.com/Auxx-Ai/auxx-ai/issues/1017)) ([9583a78](https://github.com/Auxx-Ai/auxx-ai/commit/9583a78438919dae4c1f958bbb1a5b7a070e21b1))


### Bug Fixes

* **data-connectors:** collapse delete menu when no records synced ([#991](https://github.com/Auxx-Ai/auxx-ai/issues/991)) ([c1015a6](https://github.com/Auxx-Ai/auxx-ai/commit/c1015a6d3b97ce8c3fdf0b29c9d450c4d538e2ed))
* **data-connectors:** full-wipe schema teardown + surface setup-phase errors ([#1010](https://github.com/Auxx-Ai/auxx-ai/issues/1010)) ([2bc4b64](https://github.com/Auxx-Ai/auxx-ai/commit/2bc4b64bb773acbc1a6803997db6f82acb39a5ca))
* **data-connectors:** lazy owned-def field picker projection-aware ([#1005](https://github.com/Auxx-Ai/auxx-ai/issues/1005)) ([1af71d6](https://github.com/Auxx-Ai/auxx-ai/commit/1af71d67e99bbf9c82a904f16b7a240e5c1b6c53))
* **data-connectors:** namespace app relationshipFieldKey + struct source-field mapping ([#1020](https://github.com/Auxx-Ai/auxx-ai/issues/1020)) ([46911ff](https://github.com/Auxx-Ai/auxx-ai/commit/46911ff67a21370139ca7e33cfbc0d25ae31c8a2))
* **data-connectors:** stop double-rendering visible-leaf bare tokens as formula rows ([#992](https://github.com/Auxx-Ai/auxx-ai/issues/992)) ([cfad2d2](https://github.com/Auxx-Ai/auxx-ai/commit/cfad2d253132b2e91379cb27ffe8888842b10538))
* **dynamic-table:** bulk-mode row click toggles instead of collapsing selection ([#993](https://github.com/Auxx-Ai/auxx-ai/issues/993)) ([f1223bf](https://github.com/Auxx-Ai/auxx-ai/commit/f1223bfe40375eccd02132d84d2b1b221f6c7495))
* **export:** populate CSV cells + reorganize export/import history UI ([#1029](https://github.com/Auxx-Ai/auxx-ai/issues/1029)) ([cf316d1](https://github.com/Auxx-Ai/auxx-ai/commit/cf316d15929acac8ee82445e268ba332ed03897b))
* **identity:** stamp appSlug/isIdentity durably so RecordIdentity mirrors + reconcile work ([#1030](https://github.com/Auxx-Ai/auxx-ai/issues/1030)) ([b328fa1](https://github.com/Auxx-Ai/auxx-ai/commit/b328fa128ea4fb29c2592bc26d71a67c648de10b))
* **records:** primary cell shows loading skeleton instead of "Untitled" ([#999](https://github.com/Auxx-Ai/auxx-ai/issues/999)) ([6f30ddd](https://github.com/Auxx-Ai/auxx-ai/commit/6f30ddd378762001468accaf78b01cff17d2ec5c))

## [0.1.170](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.169...auxx-v0.1.170) (2026-06-29)


### Features

* **actions:** dynamic-select quick-action inputs ([#881](https://github.com/Auxx-Ai/auxx-ai/issues/881)) ([bc8ac6b](https://github.com/Auxx-Ai/auxx-ai/commit/bc8ac6be77b86e2eee3af5dbdeb5f8e494ac3c4b))
* **ai:** add Grok and Z.AI providers ([#980](https://github.com/Auxx-Ai/auxx-ai/issues/980)) ([c74ac49](https://github.com/Auxx-Ai/auxx-ai/commit/c74ac497743f7063f83ed655550b0070f46c6c66))
* **ai:** provider key picker + credential dialog refactor ([#916](https://github.com/Auxx-Ai/auxx-ai/issues/916)) ([096577b](https://github.com/Auxx-Ai/auxx-ai/commit/096577beac19c3ad68e905472555ac8bfcae4d43))
* app record actions + async option picker ([#883](https://github.com/Auxx-Ai/auxx-ai/issues/883)) ([d492638](https://github.com/Auxx-Ai/auxx-ai/commit/d49263819b61457da769d1fb78fbaf27c482c698))
* **apps:** capability badges on app About page ([#936](https://github.com/Auxx-Ai/auxx-ai/issues/936)) ([d48ffd8](https://github.com/Auxx-Ai/auxx-ai/commit/d48ffd887aabcfca84d12af3d16926a403b6be6e))
* **composer:** float chat composer toolbar over editor ([#884](https://github.com/Auxx-Ai/auxx-ai/issues/884)) ([9fc5666](https://github.com/Auxx-Ai/auxx-ai/commit/9fc5666f8c4044e78ace39353c4c000f80047860))
* **connections:** block deleting a connection in use by a channel ([#924](https://github.com/Auxx-Ai/auxx-ai/issues/924)) ([90bb6ec](https://github.com/Auxx-Ai/auxx-ai/commit/90bb6ec9898351b5545000f3a5b1e957f776b8f2))
* **connections:** brand icons for provider catalog + SSE stream cleanup ([#904](https://github.com/Auxx-Ai/auxx-ai/issues/904)) ([a3b972d](https://github.com/Auxx-Ai/auxx-ai/commit/a3b972d7d254ca9abb8c6be7ae35686133071e3c))
* **connections:** drop integration auth-state, move to credential auth-state ([#920](https://github.com/Auxx-Ai/auxx-ai/issues/920)) ([bd3447b](https://github.com/Auxx-Ai/auxx-ai/commit/bd3447b297696810d6d3d62b721d5d7994352e51))
* **connections:** edit-safe secret masking + merge-on-save ([#910](https://github.com/Auxx-Ai/auxx-ai/issues/910)) ([c866c03](https://github.com/Auxx-Ai/auxx-ai/commit/c866c03b8e73f4c6fa65804fcea0217a94d29e36))
* **connections:** fold AI providers onto connections ([#912](https://github.com/Auxx-Ai/auxx-ai/issues/912)) ([0b39123](https://github.com/Auxx-Ai/auxx-ai/commit/0b39123625bc37a395cceedc46a629122ea9ac4e))
* **connections:** fold Gmail/Outlook channel OAuth onto generic connections ([#919](https://github.com/Auxx-Ai/auxx-ai/issues/919)) ([eeda572](https://github.com/Auxx-Ai/auxx-ai/commit/eeda572f5baa76cb9ce0e6d0a0ec2d7e58e708a5))
* **connections:** fold OpenPhone (Quo) SMS channel onto connections ([#922](https://github.com/Auxx-Ai/auxx-ai/issues/922)) ([82a2347](https://github.com/Auxx-Ai/auxx-ai/commit/82a2347abe3b0615dba364ab8e951ceaf5e9cc3f))
* **connections:** fold social channel OAuth onto connections + grouped connection stacks ([#921](https://github.com/Auxx-Ai/auxx-ai/issues/921)) ([1714542](https://github.com/Auxx-Ai/auxx-ai/commit/171454286421ecf246853e61be73f76c42bd619f))
* **connections:** move connection management to a Settings page ([#898](https://github.com/Auxx-Ai/auxx-ai/issues/898)) ([526b585](https://github.com/Auxx-Ai/auxx-ai/commit/526b58544f8d9eb8a66fb95dc53b392e50b02857))
* **connections:** multiple connection methods per app ([#906](https://github.com/Auxx-Ai/auxx-ai/issues/906)) ([3c955dd](https://github.com/Auxx-Ai/auxx-ai/commit/3c955dd85c8035e18a145b2f2db2c36f038ec59f))
* **connections:** platform-provider saver + unified connect routes ([#897](https://github.com/Auxx-Ai/auxx-ai/issues/897)) ([1ff18dc](https://github.com/Auxx-Ai/auxx-ai/commit/1ff18dc99277b0c9824972449516b9a4955e3762))
* **connections:** provider brand icons in picker + template connection hints ([#907](https://github.com/Auxx-Ai/auxx-ai/issues/907)) ([57aea7c](https://github.com/Auxx-Ai/auxx-ai/commit/57aea7ccb69ecff66d4d17b7252e2b5d372e7625))
* **connections:** rename connections + shared connection display ([#917](https://github.com/Auxx-Ai/auxx-ai/issues/917)) ([dffaece](https://github.com/Auxx-Ai/auxx-ai/commit/dffaece9a2300d59e0796927d833f78f596d8fbc))
* **connections:** server-minted client_credentials grant ([#911](https://github.com/Auxx-Ai/auxx-ai/issues/911)) ([61853a9](https://github.com/Auxx-Ai/auxx-ai/commit/61853a90384cb018b78551e3e952901ad0cd64fe))
* **connections:** unify connect dialogs + transport layer ([#909](https://github.com/Auxx-Ai/auxx-ai/issues/909)) ([2d5d85f](https://github.com/Auxx-Ai/auxx-ai/commit/2d5d85fe6b8abbb2d4704d8e083ee6a94e4429f4))
* **connections:** unify on ConnectionDefinition as the single provider model ([#896](https://github.com/Auxx-Ai/auxx-ai/issues/896)) ([806ea40](https://github.com/Auxx-Ai/auxx-ai/commit/806ea40d9470d4c2b12898a02877eb7533234b0d))
* **data-connectors:** allow custom values in tool-backed dynamic-select config fields ([#947](https://github.com/Auxx-Ai/auxx-ai/issues/947)) ([5329e7e](https://github.com/Auxx-Ai/auxx-ai/commit/5329e7e85b0de2f329f4ad244c86b916fb2aa851))
* **data-connectors:** app-trigger → connector sync bridge via webhooks ([#957](https://github.com/Auxx-Ai/auxx-ai/issues/957)) ([2ef408d](https://github.com/Auxx-Ai/auxx-ai/commit/2ef408d9277e8b32e008e538c1e8ac1506877de5))
* **data-connectors:** canonical ResourceFieldId field refs ([#914](https://github.com/Auxx-Ai/auxx-ai/issues/914)) ([fc1f123](https://github.com/Auxx-Ai/auxx-ai/commit/fc1f123aa793f1aaecd5738761f62b33f9ddea20))
* **data-connectors:** connector progress UX (Step 9) ([#929](https://github.com/Auxx-Ai/auxx-ai/issues/929)) ([b1ebd8f](https://github.com/Auxx-Ai/auxx-ai/commit/b1ebd8f1aa66b7d3731ca73e080d052f790bd14d))
* **data-connectors:** draft-in-place commit reconcile + header action cluster ([#985](https://github.com/Auxx-Ai/auxx-ai/issues/985)) ([70231ed](https://github.com/Auxx-Ai/auxx-ai/commit/70231ed641235aba00a0bb6c91fcef5626d1181f))
* **data-connectors:** field lock & provenance ([#935](https://github.com/Auxx-Ai/auxx-ai/issues/935)) ([8f51c09](https://github.com/Auxx-Ai/auxx-ai/commit/8f51c0934f1bfec4f46b8a294521e497617ffb0e))
* **data-connectors:** field-type-aware mapping with compatibility guards ([#900](https://github.com/Auxx-Ai/auxx-ai/issues/900)) ([2743f33](https://github.com/Auxx-Ai/auxx-ai/commit/2743f33540d731e47dfefdba5b223e70e653c947))
* **data-connectors:** first-party connector templates + connect-a-source catalog ([#903](https://github.com/Auxx-Ai/auxx-ai/issues/903)) ([1cd36f2](https://github.com/Auxx-Ai/auxx-ai/commit/1cd36f2772d5b06aa142002aa5a6d435f164b083))
* **data-connectors:** generic connection picker + source-relative identity ([#895](https://github.com/Auxx-Ai/auxx-ai/issues/895)) ([895899b](https://github.com/Auxx-Ai/auxx-ai/commit/895899b021a73d90c518761c41535ad3232e170e))
* **data-connectors:** live sync status over realtime ([#970](https://github.com/Auxx-Ai/auxx-ai/issues/970)) ([836479e](https://github.com/Auxx-Ai/auxx-ai/commit/836479e0069df344fb48538052ed1789a00aedcd))
* **data-connectors:** mapping empty-state CTAs + leaf cap + Stripe cursor pagination ([#934](https://github.com/Auxx-Ai/auxx-ai/issues/934)) ([8ddd8b9](https://github.com/Auxx-Ai/auxx-ai/commit/8ddd8b95c862e6598708e11ea3d010ca9faec885))
* **data-connectors:** mapping-edit safety (resyncPending + banner) ([#942](https://github.com/Auxx-Ai/auxx-ai/issues/942)) ([0f0e97c](https://github.com/Auxx-Ai/auxx-ai/commit/0f0e97ca0771101edff749b3f3e963302d041742))
* **data-connectors:** materialize owned default-mappings at app setup ([#941](https://github.com/Auxx-Ai/auxx-ai/issues/941)) ([729eb88](https://github.com/Auxx-Ai/auxx-ai/commit/729eb885e03835838ff914cbe72c03393c326374))
* **data-connectors:** merge-strategy badge toggle + connector shared headers ([#918](https://github.com/Auxx-Ai/auxx-ai/issues/918)) ([7a20718](https://github.com/Auxx-Ai/auxx-ai/commit/7a20718f652c0d9b900d261c7a3630b78e7b65a5))
* **data-connectors:** multi-stream setup overview + optional first sync ([#948](https://github.com/Auxx-Ai/auxx-ai/issues/948)) ([9d757e3](https://github.com/Auxx-Ai/auxx-ai/commit/9d757e3fbbf8e573428d313507b50b8c80a935f5))
* **data-connectors:** paginate app connectors + resumable sync (Step 11) ([#938](https://github.com/Auxx-Ai/auxx-ai/issues/938)) ([1331580](https://github.com/Auxx-Ai/auxx-ai/commit/13315802046d5f4ad7c420080a2f6c99be766579))
* **data-connectors:** pagination stall guard + webhook steering token fields ([#967](https://github.com/Auxx-Ai/auxx-ai/issues/967)) ([ec2f696](https://github.com/Auxx-Ai/auxx-ai/commit/ec2f696f396581e090c2e26bb70ba5ea3b878244))
* **data-connectors:** pagination transparency + auto-detect (Step 10) ([#933](https://github.com/Auxx-Ai/auxx-ai/issues/933)) ([c055533](https://github.com/Auxx-Ai/auxx-ai/commit/c0555335897efb0ea35e6407867b31af225ee137))
* **data-connectors:** per-stream request editors + humanized field picker ([#915](https://github.com/Auxx-Ai/auxx-ai/issues/915)) ([9ae0f45](https://github.com/Auxx-Ai/auxx-ai/commit/9ae0f45b45a8e6c29ac35d14ac145b38f78ac278))
* **data-connectors:** progress UX + mapping suggester + slicing ([#932](https://github.com/Auxx-Ai/auxx-ai/issues/932)) ([da8264f](https://github.com/Auxx-Ai/auxx-ai/commit/da8264fc9a78bc8b76dcc003b1a453df50248dc3))
* **data-connectors:** reachability probe + Connecting status for fresh syncs ([#986](https://github.com/Auxx-Ai/auxx-ai/issues/986)) ([55ded9e](https://github.com/Auxx-Ai/auxx-ai/commit/55ded9ec490b26abea7a4a52682cb27cae83dba0))
* **data-connectors:** relationship linking redesign ([#974](https://github.com/Auxx-Ai/auxx-ai/issues/974)) ([74f2edf](https://github.com/Auxx-Ai/auxx-ai/commit/74f2edffd181e29d8c8ddf52b0a45b6d040470e7))
* **data-connectors:** run-history retention + webhook freshness + runs panel redesign ([#973](https://github.com/Auxx-Ai/auxx-ai/issues/973)) ([095fbd3](https://github.com/Auxx-Ai/auxx-ai/commit/095fbd388314f6439b18985c62f687910c3714dd))
* **data-connectors:** runs panel as TreeRow history + shared run-status meta ([#939](https://github.com/Auxx-Ai/auxx-ai/issues/939)) ([7d8a276](https://github.com/Auxx-Ai/auxx-ai/commit/7d8a276280d3606e3fbb868b96bcf70ce2a25357))
* **data-connectors:** sync external records into the entity system ([#893](https://github.com/Auxx-Ai/auxx-ai/issues/893)) ([f7d2239](https://github.com/Auxx-Ai/auxx-ai/commit/f7d22399776daaa76ba01118cb6b348db335d5d9))
* **data-connectors:** sync robustness — stale recovery, rate-limit signal, ingest ceiling ([#944](https://github.com/Auxx-Ai/auxx-ai/issues/944)) ([891486d](https://github.com/Auxx-Ai/auxx-ai/commit/891486d4d6aaf637a933fe1f68cbbe4e27920839))
* **data-connectors:** templates seed contributing target mappings + provision at sync ([#905](https://github.com/Auxx-Ai/auxx-ai/issues/905)) ([064efb7](https://github.com/Auxx-Ai/auxx-ai/commit/064efb7b5c34b6040eede829489afc5147ac441a))
* **data-connectors:** tool-backed dynamic-select for connector config fields ([#943](https://github.com/Auxx-Ai/auxx-ai/issues/943)) ([029c2ff](https://github.com/Auxx-Ai/auxx-ai/commit/029c2ffeb4588c0d469d02886bd6c38ed0537124))
* **data-connectors:** trial sync — sample run, park for review, sync everything ([#949](https://github.com/Auxx-Ai/auxx-ai/issues/949)) ([21052ea](https://github.com/Auxx-Ai/auxx-ai/commit/21052eae43c563b57b62d267dda9823c78925699))
* **data-connectors:** unified connector saving model (v4) ([#979](https://github.com/Auxx-Ai/auxx-ai/issues/979)) ([ebeea97](https://github.com/Auxx-Ai/auxx-ai/commit/ebeea97201e554b61001ade7b295d1bb2de1ebb0))
* **data-connectors:** unified save bar + shared test-fetch runtime ([#908](https://github.com/Auxx-Ai/auxx-ai/issues/908)) ([63c89d3](https://github.com/Auxx-Ai/auxx-ai/commit/63c89d3eccb3505edbba1ce3407890a563010f7f))
* **data-connectors:** webhook deliveries steer a full run-based sync ([#969](https://github.com/Auxx-Ai/auxx-ai/issues/969)) ([35138e9](https://github.com/Auxx-Ai/auxx-ai/commit/35138e95cefeda656c3864f7c9d5a5443f0b9127))
* **data-connectors:** webhook deliveries steer a targeted partial run ([#971](https://github.com/Auxx-Ai/auxx-ai/issues/971)) ([c816115](https://github.com/Auxx-Ai/auxx-ai/commit/c81611557ff6f3683ea6d9888b6495a59eb7aa25))
* **kbar:** "Create field" contextual action on records table ([#902](https://github.com/Auxx-Ai/auxx-ai/issues/902)) ([b6816da](https://github.com/Auxx-Ai/auxx-ai/commit/b6816da4de5fcd6dd94765086d09dcaa346d57cd))
* **kbar:** embed create forms in command palette ([#888](https://github.com/Auxx-Ai/auxx-ai/issues/888)) ([fcaaf5e](https://github.com/Auxx-Ai/auxx-ai/commit/fcaaf5e4a18aa99df075a1f2f705b4e5741d9a1c))
* **kbar:** embed snippet/signature/task create forms in palette ([#887](https://github.com/Auxx-Ai/auxx-ai/issues/887)) ([27d36f3](https://github.com/Auxx-Ai/auxx-ai/commit/27d36f3e01efe49d98e2dccc327d11c1099d8d96))
* **kbar:** full-height mobile sheet for command palette ([#892](https://github.com/Auxx-Ai/auxx-ai/issues/892)) ([2f70af7](https://github.com/Auxx-Ai/auxx-ai/commit/2f70af7e53f3106cb6e88ccd45ec565ca0aefce1))
* **kbar:** in-palette thread reader on Search threads page ([#891](https://github.com/Auxx-Ai/auxx-ai/issues/891)) ([408996a](https://github.com/Auxx-Ai/auxx-ai/commit/408996a1ddf3afe0c92a5dc5b083ec4b4af8f125))
* **kbar:** page-defined contextual actions in command palette ([#889](https://github.com/Auxx-Ai/auxx-ai/issues/889)) ([56797d0](https://github.com/Auxx-Ai/auxx-ai/commit/56797d061dece0c26280908c2723610d1edacc8c))
* **logger:** searchable dev log history via OpenObserve ([#954](https://github.com/Auxx-Ai/auxx-ai/issues/954)) ([2ab74e5](https://github.com/Auxx-Ai/auxx-ai/commit/2ab74e57cc7098cc2c2e79203e1ab394caba26f2))
* **realtime:** coarse invalidate on bulk writes + owned-mapping delete safety ([#945](https://github.com/Auxx-Ai/auxx-ai/issues/945)) ([4c723e4](https://github.com/Auxx-Ai/auxx-ai/commit/4c723e4bcb91f8f70c1dff04a3dc237e21118a79))
* **realtime:** self-host Sockudo transport (Pusher-protocol) ([#956](https://github.com/Auxx-Ai/auxx-ai/issues/956)) ([c10e122](https://github.com/Auxx-Ai/auxx-ai/commit/c10e122c2deefb9984576dfa4b8942b6e7931304))
* **sync-core:** async bulk-export engine seam (Step 7a) ([#927](https://github.com/Auxx-Ai/auxx-ai/issues/927)) ([175afc3](https://github.com/Auxx-Ai/auxx-ai/commit/175afc32546e327ff58964e8a1752fcdcc076355))
* **sync-core:** enriched PaginationSpec — next-url, has_more, last-record cursor, offset base ([#926](https://github.com/Auxx-Ai/auxx-ai/issues/926)) ([aeaf03a](https://github.com/Auxx-Ai/auxx-ai/commit/aeaf03af63721e297e0f06f7c2a25c0635e27e12))
* **sync-core:** foundations — rate limits, state/ledger schema, adapters ([#923](https://github.com/Auxx-Ai/auxx-ai/issues/923)) ([b0b9ed7](https://github.com/Auxx-Ai/auxx-ai/commit/b0b9ed78c4cd67df58cd3b835ed8f2bb855b5dfa))
* **sync-core:** sliced resumable backfill + watermark steady mode ([#925](https://github.com/Auxx-Ai/auxx-ai/issues/925)) ([b921888](https://github.com/Auxx-Ai/auxx-ai/commit/b92188862774623a73fe4c9a7a9bed3ae14ad4a3))
* **sync-core:** webhook ingress + delete safety (Step 8) ([#928](https://github.com/Auxx-Ai/auxx-ai/issues/928)) ([59483bd](https://github.com/Auxx-Ai/auxx-ai/commit/59483bdb2fc3c970efadb32fada6f5442077b5a8))
* **triggers:** unified app + WebhookEndpoint trigger picker ([#961](https://github.com/Auxx-Ai/auxx-ai/issues/961)) ([ea3d770](https://github.com/Auxx-Ai/auxx-ai/commit/ea3d7707b0e20daa8030d043ca495b9268f8aae5))
* **ui:** records-view guide + shared guide shortcut primitives ([#981](https://github.com/Auxx-Ai/auxx-ai/issues/981)) ([a6e9fbd](https://github.com/Auxx-Ai/auxx-ai/commit/a6e9fbd00c684584034279ed99af18f139b3a6e2))
* **ui:** shared MetricGrid + CSV utils + full-bleed drawer cards ([#930](https://github.com/Auxx-Ai/auxx-ai/issues/930)) ([9005db8](https://github.com/Auxx-Ai/auxx-ai/commit/9005db844d5dec76cab77028eb0215675054bc8b))
* **ui:** unify list-page layout (toolbar + view-mode + scroll primitives) ([#978](https://github.com/Auxx-Ai/auxx-ai/issues/978)) ([a980bfe](https://github.com/Auxx-Ai/auxx-ai/commit/a980bfeeb40e87b2b827f8260955d6e47e5cedab))
* **ui:** unify list/grid cards into one ListCard primitive ([#976](https://github.com/Auxx-Ai/auxx-ai/issues/976)) ([07b11f0](https://github.com/Auxx-Ai/auxx-ai/commit/07b11f0f80552814e6a11020f2fd9ae1d2c4e7af))
* **web:** add Quick Actions button to sidebar header ([#890](https://github.com/Auxx-Ai/auxx-ai/issues/890)) ([9d623df](https://github.com/Auxx-Ai/auxx-ai/commit/9d623df166c43b8a6e97d9bfc9d7376fa8fab529))
* **webhooks:** connection-keyed webhook trigger UI for workflows and agents ([#952](https://github.com/Auxx-Ai/auxx-ai/issues/952)) ([255bd98](https://github.com/Auxx-Ai/auxx-ai/commit/255bd986554685bc23e18856566a7ecb6833a066))
* **webhooks:** connection-keyed webhook triggers for workflows and agents ([#951](https://github.com/Auxx-Ai/auxx-ai/issues/951)) ([5354372](https://github.com/Auxx-Ai/auxx-ai/commit/5354372f4e294dbfa483cf82eff7bc052ae417f6))
* **webhooks:** declared topics on WebhookEndpoint with per-topic payload schema ([#965](https://github.com/Auxx-Ai/auxx-ai/issues/965)) ([47a17a4](https://github.com/Auxx-Ai/auxx-ai/commit/47a17a40b73bd19ced59aeb2079a8e910dfe3322))
* **webhooks:** inbound WebhookEndpoint management UI + section redesign ([#960](https://github.com/Auxx-Ai/auxx-ai/issues/960)) ([ab54bfa](https://github.com/Auxx-Ai/auxx-ai/commit/ab54bfa18f19d0e76079c9a955853168668d634e))
* **webhooks:** live WebhookEndpoint delivery inspector + TreeRow trigger source rows ([#963](https://github.com/Auxx-Ai/auxx-ai/issues/963)) ([dd43aec](https://github.com/Auxx-Ai/auxx-ai/commit/dd43aec7bfba5442e55cdbc3dd1d97668dbca893))
* **webhooks:** provider-agnostic inbound WebhookEndpoint source ([#959](https://github.com/Auxx-Ai/auxx-ai/issues/959)) ([41a55a1](https://github.com/Auxx-Ai/auxx-ai/commit/41a55a1b4632c54ee2cce695048e646c139af166))


### Bug Fixes

* **connections:** clear reauth/sync state on reconnect; overage count fixes ([#955](https://github.com/Auxx-Ai/auxx-ai/issues/955)) ([87ba539](https://github.com/Auxx-Ai/auxx-ai/commit/87ba5396d281f0c1984be84a0541b5730f74993d))
* **data-connectors:** allow connector-config option resolver through lambda validator ([#950](https://github.com/Auxx-Ai/auxx-ai/issues/950)) ([f794e64](https://github.com/Auxx-Ai/auxx-ai/commit/f794e64afc3d48fd4f5b759f7b38493ebc10d3a1))
* **data-connectors:** delete/archive connector-created records on connector delete ([#975](https://github.com/Auxx-Ai/auxx-ai/issues/975)) ([46f3711](https://github.com/Auxx-Ai/auxx-ai/commit/46f3711cd32d9926e0bcabd4f064783e9289fba9))
* **data-connectors:** don't auto-skip Connect step for app connectors ([#972](https://github.com/Auxx-Ai/auxx-ai/issues/972)) ([5537646](https://github.com/Auxx-Ai/auxx-ai/commit/5537646dbeb51880f19d2efa233d896adb9fcde8))
* **data-connectors:** drop per-keystroke typeahead, render config field descriptions ([b0d8946](https://github.com/Auxx-Ai/auxx-ai/commit/b0d89467327b02168469e41f46cd9969635d23fb))
* **data-connectors:** re-assert overwrite fields on destination drift ([#940](https://github.com/Auxx-Ai/auxx-ai/issues/940)) ([4586754](https://github.com/Auxx-Ai/auxx-ai/commit/45867540a35c8fcc40a2c7ebdaf8ebb9b2a4b064))
* **data-connectors:** reflect ingested count on failed/parked syncs ([#946](https://github.com/Auxx-Ai/auxx-ai/issues/946)) ([5315e52](https://github.com/Auxx-Ai/auxx-ai/commit/5315e522bcc8c7d4eda24093170bf99c038a4176))
* **data-connectors:** separate webhook steering from syncMode ([#977](https://github.com/Auxx-Ai/auxx-ai/issues/977)) ([e954e8f](https://github.com/Auxx-Ai/auxx-ai/commit/e954e8f316c9eac5d30fba812e17f326ee9edd2e))


### Performance Improvements

* **mail:** hoist per-row thread-mutation toolkit to one app-wide provider ([#984](https://github.com/Auxx-Ai/auxx-ai/issues/984)) ([4acdf37](https://github.com/Auxx-Ai/auxx-ai/commit/4acdf37fc18e5c9b1d55d3c5b92e5a0d75e0f2c5))
* **mail:** stop selection changes re-rendering the whole thread list ([#983](https://github.com/Auxx-Ai/auxx-ai/issues/983)) ([a5ecb7f](https://github.com/Auxx-Ai/auxx-ai/commit/a5ecb7f32f851733f2cd913f7f1c51655ee10dc3))
* **ui:** stop whole-table re-render on selection in records table ([#982](https://github.com/Auxx-Ai/auxx-ai/issues/982)) ([6e8dfcb](https://github.com/Auxx-Ai/auxx-ai/commit/6e8dfcbe65f76e631371a51f36ed28aa279016b9))

## [0.1.169](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.168...auxx-v0.1.169) (2026-06-17)


### Bug Fixes

* **workflow:** exclude hidden app-block fields from single-node inputs ([#879](https://github.com/Auxx-Ai/auxx-ai/issues/879)) ([6df3d7f](https://github.com/Auxx-Ai/auxx-ai/commit/6df3d7fe6a7aeee56f9e1c67569ab980dcc4fbe4))

## [0.1.168](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.167...auxx-v0.1.168) (2026-06-17)


### Features

* **chat:** render visit facts as FieldValue-backed thread fields ([#856](https://github.com/Auxx-Ai/auxx-ai/issues/856)) ([7ae7bc7](https://github.com/Auxx-Ai/auxx-ai/commit/7ae7bc78743cffdf82b21d2522a687ee6e0336f5))
* **chat:** unify handoff into one tool + one applier ([#862](https://github.com/Auxx-Ai/auxx-ai/issues/862)) ([deff818](https://github.com/Auxx-Ai/auxx-ai/commit/deff8188aae05aabbae4f4ec951239003e86ba6a))
* **mail:** "@" signature + action picker via the chip pipeline ([#873](https://github.com/Auxx-Ai/auxx-ai/issues/873)) ([2f79b4c](https://github.com/Auxx-Ai/auxx-ai/commit/2f79b4c7b9320b0d63c12678369f12a129161900))
* **mail:** "/" slash attach-file drill-in ([#870](https://github.com/Auxx-Ai/auxx-ai/issues/870)) ([d35cc87](https://github.com/Auxx-Ai/auxx-ai/commit/d35cc872098b4d240d30a6850f7372fb3010bee0))
* **mail:** "Ask AI" slash drill-in + stale-pending-message sweeper ([#867](https://github.com/Auxx-Ai/auxx-ai/issues/867)) ([8b01a5e](https://github.com/Auxx-Ai/auxx-ai/commit/8b01a5e9467d19ed00c00bc53893d24e46e32cf5))
* **mail:** free-text "Ask AI" instruction in the / menu ([#876](https://github.com/Auxx-Ai/auxx-ai/issues/876)) ([15659b2](https://github.com/Auxx-Ai/auxx-ai/commit/15659b2ed350fb766d9821fc831bea1bda9acbc2))
* **mail:** plain chat composer variant + redesigned file picker ([#868](https://github.com/Auxx-Ai/auxx-ai/issues/868)) ([7573004](https://github.com/Auxx-Ai/auxx-ai/commit/7573004d72d8ce8455eed86274da1e6a52de3d56))
* **mail:** upload-from-computer in / file picker + consistent picker order ([#874](https://github.com/Auxx-Ai/auxx-ai/issues/874)) ([d4a00f4](https://github.com/Auxx-Ai/auxx-ai/commit/d4a00f4bb500b35a3b8da62be15d04139d2e01c9))
* **notifications:** cross-tab realtime sync + notification center refresh ([#859](https://github.com/Auxx-Ai/auxx-ai/issues/859)) ([d86443c](https://github.com/Auxx-Ai/auxx-ai/commit/d86443c99475f469896632617f3105132506666e))
* **settings:** My Account page + notification sound prefs + new-message cue ([#860](https://github.com/Auxx-Ai/auxx-ai/issues/860)) ([ed7a38e](https://github.com/Auxx-Ai/auxx-ai/commit/ed7a38e7f9b4978e233416aa3fdf74688ed809bc))
* **web:** out-of-tab new-message indicator + notification sounds ([#861](https://github.com/Auxx-Ai/auxx-ai/issues/861)) ([28d4b51](https://github.com/Auxx-Ai/auxx-ai/commit/28d4b5142866f46f7459c8eb2c853ff4bee6186d))


### Bug Fixes

* **contacts:** render contact displayName in drawer header + batch NAME field writes ([#858](https://github.com/Auxx-Ai/auxx-ai/issues/858)) ([af149e2](https://github.com/Auxx-Ai/auxx-ai/commit/af149e271643397b6e09fd039ad523886a97be59))
* **field-values:** resolve created/updated for EntityInstance entities ([#877](https://github.com/Auxx-Ai/auxx-ai/issues/877)) ([8dd3e6f](https://github.com/Auxx-Ai/auxx-ai/commit/8dd3e6f8e0b9fc647092d0bcda0e140bc20bd957))
* **fields:** optimistically update record displayName on NAME edit ([e2f1fb6](https://github.com/Auxx-Ai/auxx-ai/commit/e2f1fb6b91b9b30a2e89c6499d877c15830c4026))
* **files:** breadcrumbs on refresh, upload-to-current-folder, stuck "moving" state ([#871](https://github.com/Auxx-Ai/auxx-ai/issues/871)) ([e25ac2d](https://github.com/Auxx-Ai/auxx-ai/commit/e25ac2d9284df4093ce956aabdd7f9ca2fd8b4c7))
* **mail:** always center ThreadDisplay ([#878](https://github.com/Auxx-Ai/auxx-ai/issues/878)) ([816cb5d](https://github.com/Auxx-Ai/auxx-ai/commit/816cb5d98c72dcaac554a73e8735f44122e97295))
* **mail:** restore quick-action inline form ([#875](https://github.com/Auxx-Ai/auxx-ai/issues/875)) ([b28a9cb](https://github.com/Auxx-Ai/auxx-ai/commit/b28a9cb88b7144f67a22df2aa2370855b9b2508f))
* **realtime:** recover chat messages missed during subscribe gaps; fix off-page toasts ([#863](https://github.com/Auxx-Ai/auxx-ai/issues/863)) ([531791f](https://github.com/Auxx-Ai/auxx-ai/commit/531791f4ba4a696b80f9993fc8a402f496b4e0ad))

## [0.1.167](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.166...auxx-v0.1.167) (2026-06-16)


### Features

* **chat-widget:** mobile-responsive settings + full-screen preview ([#852](https://github.com/Auxx-Ai/auxx-ai/issues/852)) ([124f72f](https://github.com/Auxx-Ai/auxx-ai/commit/124f72fc77362f576567ddd346144fbc24115bc7))
* **chat:** lock composer on closed threads + visitor-channel event fan-out ([#853](https://github.com/Auxx-Ai/auxx-ai/issues/853)) ([28ec2d5](https://github.com/Auxx-Ai/auxx-ai/commit/28ec2d5de75688a9b64ad6147cdf28e1bbc88340))
* **chat:** serve widget bundle from cdn.auxx.ai ([#850](https://github.com/Auxx-Ai/auxx-ai/issues/850)) ([45c6fad](https://github.com/Auxx-Ai/auxx-ai/commit/45c6fadda750b0d9abb2a36286388caf5291f710))
* **chat:** single shared Pusher connection for the widget + admin realtime cleanup ([#855](https://github.com/Auxx-Ai/auxx-ai/issues/855)) ([9a96f12](https://github.com/Auxx-Ai/auxx-ai/commit/9a96f121b6d0604780686be89f126e96a7e37011))
* **chat:** surface + audience prompt profile for live chat agent ([#854](https://github.com/Auxx-Ai/auxx-ai/issues/854)) ([9e5db77](https://github.com/Auxx-Ai/auxx-ai/commit/9e5db779ffba405ae8a7c2c49c42263ca6252a16))
* **evals:** Kopilot authors simulation cases + live Simulations tab ([#846](https://github.com/Auxx-Ai/auxx-ai/issues/846)) ([1a89a9d](https://github.com/Auxx-Ai/auxx-ai/commit/1a89a9dc31c58132854fe1bb98e2ee252fd1da3c))
* file-based workflow templates + AI quota refund ([#845](https://github.com/Auxx-Ai/auxx-ai/issues/845)) ([1f3ec17](https://github.com/Auxx-Ai/auxx-ai/commit/1f3ec17436c13f33f526bee2b8172896af7cd4db))
* persona editor realtime remount + workflow app connection picker ([#843](https://github.com/Auxx-Ai/auxx-ai/issues/843)) ([3da1328](https://github.com/Auxx-Ai/auxx-ai/commit/3da1328eff850f98091dc9a79de55984e2885289))


### Bug Fixes

* **chat:** make CDN purge non-fatal in chat-publish ([#851](https://github.com/Auxx-Ai/auxx-ai/issues/851)) ([cf6ff12](https://github.com/Auxx-Ai/auxx-ai/commit/cf6ff12f82108f6d57d3e33e3cbccdfd70b71403))
* **ui:** respect iOS safe-area insets on mobile ([#847](https://github.com/Auxx-Ai/auxx-ai/issues/847)) ([0f3713b](https://github.com/Auxx-Ai/auxx-ai/commit/0f3713b431b37694239e9b6a6c715cc1fe169ff7))

## [0.1.166](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.165...auxx-v0.1.166) (2026-06-13)


### Bug Fixes

* **lambda:** add --allow-sys to dev-server deno compile ([#841](https://github.com/Auxx-Ai/auxx-ai/issues/841)) ([0171829](https://github.com/Auxx-Ai/auxx-ai/commit/0171829523fa9996d50e0a3e98b1c7a4d9477a78))

## [0.1.165](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.164...auxx-v0.1.165) (2026-06-13)


### Bug Fixes

* **sdk:** app KV storage host signature + connection-dialog suppression ([#839](https://github.com/Auxx-Ai/auxx-ai/issues/839)) ([2bb1173](https://github.com/Auxx-Ai/auxx-ai/commit/2bb117383a07b385cfb75226cd3f30d5de201cda))

## [0.1.164](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.163...auxx-v0.1.164) (2026-06-13)


### Bug Fixes

* **lambda:** add fields to ConnectionData type + validator ([#837](https://github.com/Auxx-Ai/auxx-ai/issues/837)) ([1b6729c](https://github.com/Auxx-Ai/auxx-ai/commit/1b6729c2e1c2b1720447ae29626f396c1a8c1dd7))

## [0.1.163](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.162...auxx-v0.1.163) (2026-06-13)


### Features

* **agents:** per-tool allow-lists and targeted mention locks on toolsets ([#821](https://github.com/Auxx-Ai/auxx-ai/issues/821)) ([a5f5403](https://github.com/Auxx-Ai/auxx-ai/commit/a5f54032e1df3f94bec2be62977ef7dc9557b08c))
* **apps:** app KV storage (AppStorage + SDK storage namespace) ([#833](https://github.com/Auxx-Ai/auxx-ai/issues/833)) ([de5ca57](https://github.com/Auxx-Ai/auxx-ai/commit/de5ca574868c5cde1675f959c9185b393c693612))
* **apps:** configurable OAuth refresh endpoint URL for connections ([#836](https://github.com/Auxx-Ai/auxx-ai/issues/836)) ([96d9f79](https://github.com/Auxx-Ai/auxx-ai/commit/96d9f798c33b699322bc94d92cfa7ca0e40df447))
* **apps:** lazy OAuth token refresh for app connections ([#832](https://github.com/Auxx-Ai/auxx-ai/issues/832)) ([28495d6](https://github.com/Auxx-Ai/auxx-ai/commit/28495d6cb00a34582cb8e848d62d75cbe2612455))
* **apps:** top-level connectionVariables + multi-field secret connections ([#835](https://github.com/Auxx-Ai/auxx-ai/issues/835)) ([2139a1d](https://github.com/Auxx-Ai/auxx-ai/commit/2139a1d70c7246ab4061a86ec0cb5499c6d56ebe))
* developer API keys for headless publishing + per-tool MCP selection ([#818](https://github.com/Auxx-Ai/auxx-ai/issues/818)) ([cfdfca0](https://github.com/Auxx-Ai/auxx-ai/commit/cfdfca079ef36f9163edbdf259a6eb43a38c065c))
* **editor:** arrow-key drilling + inline article-link drill in the slash menu ([#831](https://github.com/Auxx-Ai/auxx-ai/issues/831)) ([81ab044](https://github.com/Auxx-Ai/auxx-ai/commit/81ab0440e5636df2811511514066f55625114607))
* **evals:** native tool output schemas + example outputs for mock editor ([#822](https://github.com/Auxx-Ai/auxx-ai/issues/822)) ([70bbb0e](https://github.com/Auxx-Ai/auxx-ai/commit/70bbb0e8b11acaeba34f4bc0c5d2d4e75f7c64b8))
* **mcp:** output schemas with non-object roots + untrusted-output fencing ([#828](https://github.com/Auxx-Ai/auxx-ai/issues/828)) ([8728b2f](https://github.com/Auxx-Ai/auxx-ai/commit/8728b2fc4e3ca47ef943e5f618e7cb4cdd9c30bd))
* **mcp:** tool test-run + output schemas for MCP tools ([#824](https://github.com/Auxx-Ai/auxx-ai/issues/824)) ([ba28fb9](https://github.com/Auxx-Ai/auxx-ai/commit/ba28fb90259748bdf3b950b981d9be6f47b21cac))


### Bug Fixes

* **agents:** fix rapid per-tool MCP click race + suppress realtime self-echo on toolset writes ([#820](https://github.com/Auxx-Ai/auxx-ai/issues/820)) ([23b4d04](https://github.com/Auxx-Ai/auxx-ai/commit/23b4d047b7dd39825790fbb0c59d91009e9a0fe6))
* **lambda:** wire workflow-block tool dispatch (__AUXX_TOOLS__ → global) ([#834](https://github.com/Auxx-Ai/auxx-ai/issues/834)) ([bfb05e9](https://github.com/Auxx-Ai/auxx-ai/commit/bfb05e929712f010df448212e5076a7f3fdbeda5))
* **mcp:** auto-refresh OAuth tokens (lazy refresh + 401 retry + scanner enrollment) ([#829](https://github.com/Auxx-Ai/auxx-ai/issues/829)) ([9d4103c](https://github.com/Auxx-Ai/auxx-ai/commit/9d4103ccf42c5a3d4e239889c9a98f83921d746b))
* **mcp:** reliable OAuth popup completion + shared utils ([#826](https://github.com/Auxx-Ai/auxx-ai/issues/826)) ([d221dfe](https://github.com/Auxx-Ai/auxx-ai/commit/d221dfef27294e199c294829c823b2c75319bfb0))

## [0.1.162](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.161...auxx-v0.1.162) (2026-06-11)


### Features

* sdk one-shot publish, auto-update installations, and mcp manual oauth callback flow ([#816](https://github.com/Auxx-Ai/auxx-ai/issues/816)) ([c212100](https://github.com/Auxx-Ai/auxx-ai/commit/c21210079a409d5b243e716ceccc96ac585ceb77))

## [0.1.161](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.160...auxx-v0.1.161) (2026-06-11)


### Features

* **mcp:** manual OAuth setup flow for non-DCR providers ([#814](https://github.com/Auxx-Ai/auxx-ai/issues/814)) ([759ba47](https://github.com/Auxx-Ai/auxx-ai/commit/759ba47112f3397928bcbf1ac49d0555be99c340))

## [0.1.160](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.159...auxx-v0.1.160) (2026-06-11)


### Features

* **credentials:** encrypt connection client credentials at rest ([#813](https://github.com/Auxx-Ai/auxx-ai/issues/813)) ([0fb0f4f](https://github.com/Auxx-Ai/auxx-ai/commit/0fb0f4f93e3054020a9a43e7476a358d60840195))
* **mcp:** add templates, custom-header auth, and manual OAuth config ([#807](https://github.com/Auxx-Ai/auxx-ai/issues/807)) ([0790c8d](https://github.com/Auxx-Ai/auxx-ai/commit/0790c8d1d558cecde5d3a2404ff4532bdba856f8))
* **tasks:** org-wide task stats in overview header ([#808](https://github.com/Auxx-Ai/auxx-ai/issues/808)) ([2f863e8](https://github.com/Auxx-Ai/auxx-ai/commit/2f863e8f590609302b729c3b4f4e58a431c6e518))


### Bug Fixes

* **mcp:** make MCP server connect retry-safe and simplify apps section ([#805](https://github.com/Auxx-Ai/auxx-ai/issues/805)) ([747e771](https://github.com/Auxx-Ai/auxx-ai/commit/747e771322a701480d0626fec9edeb1d8fd85f87))

## [0.1.159](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.158...auxx-v0.1.159) (2026-06-11)


### Bug Fixes

* **entity-migrations:** make 004-company upgrade deterministic with duplicate defs ([#803](https://github.com/Auxx-Ai/auxx-ai/issues/803)) ([bc355c8](https://github.com/Auxx-Ai/auxx-ai/commit/bc355c8d288f1d04a4e750e2da7a28dd06fef7a7))

## [0.1.158](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.157...auxx-v0.1.158) (2026-06-11)


### Features

* **credentials:** unified credential store + crypto v2 ([#800](https://github.com/Auxx-Ai/auxx-ai/issues/800)) ([a91178c](https://github.com/Auxx-Ai/auxx-ai/commit/a91178cde2ef8e8084a55437f1adffa3aa183ee1))

## [0.1.157](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.156...auxx-v0.1.157) (2026-06-11)


### Features

* **data-migrations:** ledger + advisory lock + auto-run on boot ([#798](https://github.com/Auxx-Ai/auxx-ai/issues/798)) ([b126deb](https://github.com/Auxx-Ai/auxx-ai/commit/b126debf6e57ac6f7109dc2ef2fae589762d2ae9))

## [0.1.156](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.155...auxx-v0.1.156) (2026-06-11)


### Features

* **agents,evals:** customer-conversation envelope + eval pre-run validation ([#785](https://github.com/Auxx-Ai/auxx-ai/issues/785)) ([4743415](https://github.com/Auxx-Ai/auxx-ai/commit/47434155812e90c4714e079709832070c5732b31))
* **agents,evals:** procedure-doc mention reconciliation + eval trace tooling ([#784](https://github.com/Auxx-Ai/auxx-ai/issues/784)) ([e8ca457](https://github.com/Auxx-Ai/auxx-ai/commit/e8ca4576191eaa8d041189a526584aff9e624344))
* **agents,evals:** registered-name tool chips + eval run deletion ([#783](https://github.com/Auxx-Ai/auxx-ai/issues/783)) ([6d72b0e](https://github.com/Auxx-Ai/auxx-ai/commit/6d72b0e04a8d876d8111b698b25bdbc32d54534c))
* **agents,resources:** rebuild field badge on record-badge variants + binding picker badges ([#794](https://github.com/Auxx-Ai/auxx-ai/issues/794)) ([458e57d](https://github.com/Auxx-Ai/auxx-ai/commit/458e57d899d03e3e190d70ab5ffbd60d74cb0b2a))
* **agents:** agent versions — publish/draft lifecycle + version history ([#795](https://github.com/Auxx-Ai/auxx-ai/issues/795)) ([b34e785](https://github.com/Auxx-Ai/auxx-ai/commit/b34e785302112153116352c840115c39dce653bf))
* **agents:** chat-v9 context-variables plumbing + restrictions→bindings rename ([#741](https://github.com/Auxx-Ai/auxx-ai/issues/741)) ([20f5500](https://github.com/Auxx-Ai/auxx-ai/commit/20f55005e4ae9aac8890b0ee0f3172a71e48cc4d))
* **agents:** chat-v9 procedures phase 0 — schema, types, compiler, stack, queries ([#743](https://github.com/Auxx-Ai/auxx-ai/issues/743)) ([ee2873a](https://github.com/Auxx-Ai/auxx-ai/commit/ee2873a43772e548c9e8f5e5ff0b43ddc0ff295a))
* **agents:** chat-v9 procedures phase 1 — selection ([#745](https://github.com/Auxx-Ai/auxx-ai/issues/745)) ([b07c11f](https://github.com/Auxx-Ai/auxx-ai/commit/b07c11f0e2b38a4340ab3a4da991e56a1ef61ccf))
* **agents:** chat-v9 procedures phase 2 — editor UI + routers ([#746](https://github.com/Auxx-Ai/auxx-ai/issues/746)) ([a32f220](https://github.com/Auxx-Ai/auxx-ai/commit/a32f220836b42f579b6f0016b6f2f07ee892a0df))
* **agents:** chat-v9 procedures phase 2 fix — v2 compiler + dual-mode conditions ([#747](https://github.com/Auxx-Ai/auxx-ai/issues/747)) ([b5a39be](https://github.com/Auxx-Ai/auxx-ai/commit/b5a39bef9d7d9459c0937e37339d8cefe4fd0cac))
* **agents:** chat-v9 procedures phase 3 — versioned selection criteria + publish cluster ([#748](https://github.com/Auxx-Ai/auxx-ai/issues/748)) ([805f389](https://github.com/Auxx-Ai/auxx-ai/commit/805f3891ea5142c8c6e2c9cb6b868382fa42ccec))
* **agents:** chat-v9 procedures phase 4 — runtime stepper + control tools ([#749](https://github.com/Auxx-Ai/auxx-ai/issues/749)) ([8828481](https://github.com/Auxx-Ai/auxx-ai/commit/88284815228d9f0959daadb86a9b252d922cf1c3))
* **agents:** chat-v9 procedures phase 5 — live turn wiring ([#750](https://github.com/Auxx-Ai/auxx-ai/issues/750)) ([a5c1bcf](https://github.com/Auxx-Ai/auxx-ai/commit/a5c1bcfb441d315f743a6af4d35a2c50b401c89f))
* **agents:** chat-v9 procedures phase 6 — code inputs bag + unified drill + Monaco ([#753](https://github.com/Auxx-Ai/auxx-ai/issues/753)) ([634698d](https://github.com/Auxx-Ai/auxx-ai/commit/634698deae02a5b3156a3694fd0b515e60ed14ae))
* **agents:** chat-v9 procedures phase 6 — deterministic code steps ([#752](https://github.com/Auxx-Ai/auxx-ai/issues/752)) ([a04066b](https://github.com/Auxx-Ai/auxx-ai/commit/a04066b6ccfdf5fbd1b5cdf2e034ff30132861cf))
* **agents:** chat-v9 shared context store on ctx.context ([#742](https://github.com/Auxx-Ai/auxx-ai/issues/742)) ([74551c9](https://github.com/Auxx-Ai/auxx-ai/commit/74551c92feb753d6b0b2ab7fcadca5d3cdb45015))
* **agents:** per-agent tool restrictions for chat-kind agents ([#727](https://github.com/Auxx-Ai/auxx-ai/issues/727)) ([7edc4bd](https://github.com/Auxx-Ai/auxx-ai/commit/7edc4bd12e6e661961e480fc40c475828b7eb37c))
* **agents:** per-tool surfaces + externalSafe (replace chatSafe) ([#730](https://github.com/Auxx-Ai/auxx-ai/issues/730)) ([46741b7](https://github.com/Auxx-Ai/auxx-ai/commit/46741b74e4e1c383ca51bbc16fcbde2f1df8e2eb))
* **agents:** permanently delete agents ([#770](https://github.com/Auxx-Ai/auxx-ai/issues/770)) ([d8eff28](https://github.com/Auxx-Ai/auxx-ai/commit/d8eff28c51da9ea71383cc5cbfefc7f69acfa1b2))
* **agents:** procedure realtime refresh + endsTurn terminal tools ([#782](https://github.com/Auxx-Ai/auxx-ai/issues/782)) ([525b977](https://github.com/Auxx-Ai/auxx-ai/commit/525b977ad75f79fed6a0a32b21b60778d03cba79))
* **agents:** tool category classification + UI visibility policy ([#778](https://github.com/Auxx-Ai/auxx-ai/issues/778)) ([d61acea](https://github.com/Auxx-Ai/auxx-ai/commit/d61aceacd6adb5ca2addf369ac1c16ead4210b05))
* **agents:** tool-input bindings (chat v8) ([#739](https://github.com/Auxx-Ai/auxx-ai/issues/739)) ([10876fd](https://github.com/Auxx-Ai/auxx-ai/commit/10876fd32de456bd8b30dcc0e4092bd56259d863))
* **ai,billing:** usage-based credits — meter real USD COGS per call ([#789](https://github.com/Auxx-Ai/auxx-ai/issues/789)) ([713b00c](https://github.com/Auxx-Ai/auxx-ai/commit/713b00cb7d2345b6f2a34e4a13cdd58a9dac39f2))
* **ai:** add Anthropic Fable 5 / Opus 4.8 / 4.7 and Kimi K2.6 models ([#790](https://github.com/Auxx-Ai/auxx-ai/issues/790)) ([4dfc10f](https://github.com/Auxx-Ai/auxx-ai/commit/4dfc10f6574cca583e92c748edc6c85558bfe12d))
* **ai:** prompt-cache cost tracking + 4-step agent setup rework ([#769](https://github.com/Auxx-Ai/auxx-ai/issues/769)) ([7f87844](https://github.com/Auxx-Ai/auxx-ai/commit/7f87844f71f3e704dc8dd463443314ca1344d6b3))
* **ai:** tee LLM HTTP attempts into the agent-session trace ([#761](https://github.com/Auxx-Ai/auxx-ai/issues/761)) ([27feef4](https://github.com/Auxx-Ai/auxx-ai/commit/27feef45df65e967a2a11e083e6d15693bd4cb6f))
* **ai:** utility model tier for low-stakes internal LLM calls ([#754](https://github.com/Auxx-Ai/auxx-ai/issues/754)) ([3a24e80](https://github.com/Auxx-Ai/auxx-ai/commit/3a24e801c540d23e61b765f2adb328bf3805cdfe))
* **chat:** chat-kind agent builder — v5 phase-2b ([#726](https://github.com/Auxx-Ai/auxx-ai/issues/726)) ([0690ffe](https://github.com/Auxx-Ai/auxx-ai/commit/0690ffef871ef92e430aad3cbea63c9cb6834ce7))
* **chat:** chat-kind agents — v5 phases 1–4b ([#725](https://github.com/Auxx-Ai/auxx-ai/issues/725)) ([3458adf](https://github.com/Auxx-Ai/auxx-ai/commit/3458adf17d5cb228df80f93aa94aef4c51419d45))
* **editor:** allowedBlocks allowlist + app-connection expiry detection ([#755](https://github.com/Auxx-Ai/auxx-ai/issues/755)) ([6036083](https://github.com/Auxx-Ai/auxx-ai/commit/6036083e2677842bf2fb59fc9fb1b9235579a479))
* **evals,kopilot:** suite v2 split-dock + continuation-surface resume ([#788](https://github.com/Auxx-Ai/auxx-ai/issues/788)) ([03cd7e4](https://github.com/Auxx-Ai/auxx-ai/commit/03cd7e4ebfab549d068b0f88b259871fffa5e123))
* **evals,kopilot:** suite verdict diff + draft/pinned run mode + history ([#787](https://github.com/Auxx-Ai/auxx-ai/issues/787)) ([e439212](https://github.com/Auxx-Ai/auxx-ai/commit/e4392125486215863a517bebddbbcd32ac86aae9))
* **evals,kopilot:** targeted case re-runs + approval-gated mock repair ([#792](https://github.com/Auxx-Ai/auxx-ai/issues/792)) ([d368899](https://github.com/Auxx-Ai/auxx-ai/commit/d3688998cffc3867f5c942e72c25004b38a79e66))
* **evals:** ai simulation suggester + draft-mode runs ([#779](https://github.com/Auxx-Ai/auxx-ai/issues/779)) ([6444c8d](https://github.com/Auxx-Ai/auxx-ai/commit/6444c8d83ba4483d32e576ff40144d5200437f64))
* **evals:** live tool-default mocks + persona identity sync ([#781](https://github.com/Auxx-Ai/auxx-ai/issues/781)) ([54709ae](https://github.com/Auxx-Ai/auxx-ai/commit/54709ae134e45f8cec1a1daea71177c3eb9128fa))
* **evals:** persona identity + trace UI refactor ([#780](https://github.com/Auxx-Ai/auxx-ai/issues/780)) ([7082d49](https://github.com/Auxx-Ai/auxx-ai/commit/7082d49eebacfcfc0c6d096ecf0b886ed4d2b933))
* **evals:** simulations tab UI with eval editor support ([#777](https://github.com/Auxx-Ai/auxx-ai/issues/777)) ([5047e2e](https://github.com/Auxx-Ai/auxx-ai/commit/5047e2e872381eb176266b8719c5cffb95f7ce81))
* **evals:** tool-declared exampleOutput for autofill ([#771](https://github.com/Auxx-Ai/auxx-ai/issues/771)) ([2fe374f](https://github.com/Auxx-Ai/auxx-ai/commit/2fe374f7778568798204c19a13e7b4163570429c))
* **kb:** add concurrency guard to Kopilot write tools ([#722](https://github.com/Auxx-Ai/auxx-ai/issues/722)) ([45b6d14](https://github.com/Auxx-Ai/auxx-ai/commit/45b6d1478035a9908fd6ed7918ce242c06bc8f2b))
* **kb:** article placement — articles in multiple knowledge bases ([#728](https://github.com/Auxx-Ai/auxx-ai/issues/728)) ([071ba9c](https://github.com/Auxx-Ai/auxx-ai/commit/071ba9c1cb73f343f5ea115d7db753fb91f98f87))
* **kb:** article version diff + Kopilot turn review ([#721](https://github.com/Auxx-Ai/auxx-ai/issues/721)) ([41dc334](https://github.com/Auxx-Ai/auxx-ai/commit/41dc3342531289e3fd2ce8dc9186d10fea7837b7))
* **kb:** knowledge sources — ingest external content into a KB ([#729](https://github.com/Auxx-Ai/auxx-ai/issues/729)) ([294373a](https://github.com/Auxx-Ai/auxx-ai/commit/294373afc9872f33adc247db88d1bf02502df8c9))
* **kb:** link individual articles into a KB from any KB ([#736](https://github.com/Auxx-Ai/auxx-ai/issues/736)) ([0761ad2](https://github.com/Auxx-Ai/auxx-ai/commit/0761ad29b9ae9d9e4ae829816b272554067cba06))
* **kb:** markdown-only Kopilot write tools + sequential block ids ([#737](https://github.com/Auxx-Ai/auxx-ai/issues/737)) ([1c5efa6](https://github.com/Auxx-Ai/auxx-ai/commit/1c5efa6c18f240a687349440481fcb3bcd13aa5a))
* **kb:** reuse article editor header in diff pane ([#724](https://github.com/Auxx-Ai/auxx-ai/issues/724)) ([73931ad](https://github.com/Auxx-Ai/auxx-ai/commit/73931adcc0dfccea05758cd6958c78462c5962cf))
* **kb:** website crawl knowledge source ([#731](https://github.com/Auxx-Ai/auxx-ai/issues/731)) ([9b9bf2b](https://github.com/Auxx-Ai/auxx-ai/commit/9b9bf2bdebe27c1fa8085e7174aa2cbf4a78af5a))
* **kopilot,evals:** async task-notifications + run_eval_suite tool ([#786](https://github.com/Auxx-Ai/auxx-ai/issues/786)) ([08921e3](https://github.com/Auxx-Ai/auxx-ai/commit/08921e3ad783c6f2392da690dbb2de0c6b69cec6))
* **kopilot:** inline full output schemas on tools, slim digests ([#740](https://github.com/Auxx-Ai/auxx-ai/issues/740)) ([08d98f2](https://github.com/Auxx-Ai/auxx-ai/commit/08d98f2ce28890d60103f3faecb48df594d4fcef))
* **kopilot:** render GFM prose tables in BlockCard + prose polish ([#793](https://github.com/Auxx-Ai/auxx-ai/issues/793)) ([8a0b6f2](https://github.com/Auxx-Ai/auxx-ai/commit/8a0b6f2dddefb6bc3ddaeb7bf0f5266c33e8326e))
* **mcp:** client-side MCP server support for Kopilot + agents ([#796](https://github.com/Auxx-Ai/auxx-ai/issues/796)) ([c6e528a](https://github.com/Auxx-Ai/auxx-ai/commit/c6e528a7dfc3a8a53783a5dfa61b1016a8247541))
* **mcp:** smart-paste server snippets + icon/config schema, shared fixed-window rate limiter ([#797](https://github.com/Auxx-Ai/auxx-ai/issues/797)) ([4598749](https://github.com/Auxx-Ai/auxx-ai/commit/4598749de1e19565e6d5e872762359ff12fd4f54))
* **procedures:** beta-gate agent procedures + app account reconnect UI ([#758](https://github.com/Auxx-Ai/auxx-ai/issues/758)) ([d0b5be0](https://github.com/Auxx-Ai/auxx-ai/commit/d0b5be047e165e9887b51cceab647fe40c63b6d7))
* **procedures:** building blocks popover + oauth2 reconnect var reuse ([#757](https://github.com/Auxx-Ai/auxx-ai/issues/757)) ([6fb6cc2](https://github.com/Auxx-Ai/auxx-ai/commit/6fb6cc200722f0d3cb60259f1599fdbaa4dacb18))
* **procedures:** building-block delete + multi-root condition fields ([#759](https://github.com/Auxx-Ai/auxx-ai/issues/759)) ([134a451](https://github.com/Auxx-Ai/auxx-ai/commit/134a4517272cbb6c588a99aac5760cbd74222d7d))
* **procedures:** forbid nested conditions; surface tool catalog in builder prompt ([#763](https://github.com/Auxx-Ai/auxx-ai/issues/763)) ([4d54553](https://github.com/Auxx-Ai/auxx-ai/commit/4d545539d6737474cdd03591a7a3141e8556dbd8))
* **procedures:** kopilot procedure authoring for agents-builder ([#760](https://github.com/Auxx-Ai/auxx-ai/issues/760)) ([9cc1742](https://github.com/Auxx-Ai/auxx-ai/commit/9cc17426c65b8797019116bd8c4e9398e2423f7a))
* **procedures:** validate triggerExamples server-side ([#764](https://github.com/Auxx-Ai/auxx-ai/issues/764)) ([dfaec6d](https://github.com/Auxx-Ai/auxx-ai/commit/dfaec6db75c509426e3d932c613af98050972fbe))
* **sdk:** app-registered custom fields value I/O (phase 8) ([#719](https://github.com/Auxx-Ai/auxx-ai/issues/719)) ([0047c48](https://github.com/Auxx-Ai/auxx-ai/commit/0047c48db7f621021b658385f635969907ba571b))
* **sdk:** generate typed field value I/O per app (Layer 2) ([#723](https://github.com/Auxx-Ai/auxx-ai/issues/723)) ([f305b3a](https://github.com/Auxx-Ai/auxx-ai/commit/f305b3a7c4b273469dc7f35f91f53bd14c1b7a4b))
* shopify/stripe billing coexistence + sdk provider-call errors ([#756](https://github.com/Auxx-Ai/auxx-ai/issues/756)) ([29df7b1](https://github.com/Auxx-Ai/auxx-ai/commit/29df7b16db037fbbb0e89f894edb88814bcec3ee))
* **ui:** nav-stack iOS-style push/pop navigation primitive ([#744](https://github.com/Auxx-Ai/auxx-ai/issues/744)) ([dcfc1ea](https://github.com/Auxx-Ai/auxx-ai/commit/dcfc1ea3b18229d77aa7b76a85c88444a3e66eeb))
* **ui:** reusable dialog nav header + animated wizard pages ([#733](https://github.com/Auxx-Ai/auxx-ai/issues/733)) ([a4807fe](https://github.com/Auxx-Ai/auxx-ai/commit/a4807fe043aba5f3d9ab45ea317d7971a4381141))


### Bug Fixes

* **editor:** keep bubble menu open on internal focus, close on outside click ([#767](https://github.com/Auxx-Ai/auxx-ai/issues/767)) ([f4522c5](https://github.com/Auxx-Ai/auxx-ai/commit/f4522c532b541a379180db2e4120e7cf997e3621))
* **field-values:** row-id canonical field identity ([#734](https://github.com/Auxx-Ai/auxx-ai/issues/734)) ([53507b1](https://github.com/Auxx-Ai/auxx-ai/commit/53507b1a8e796051ed6b4201f64b2113d638d03d))
* **field-values:** static-key aliases + safe display formatting ([#735](https://github.com/Auxx-Ai/auxx-ai/issues/735)) ([b529958](https://github.com/Auxx-Ai/auxx-ai/commit/b529958a2cc9fa21d4e4c84d631c62b63cd41ef5))
* **kb:** diff view follows app light/dark, not KB mode ([#738](https://github.com/Auxx-Ai/auxx-ai/issues/738)) ([50b64ef](https://github.com/Auxx-Ai/auxx-ai/commit/50b64efb57732ad4566ce4418ec61c9270aa2f6d))
* **kopilot:** builder sessions never carry a DM trigger ([#766](https://github.com/Auxx-Ai/auxx-ai/issues/766)) ([ce0f41d](https://github.com/Auxx-Ai/auxx-ai/commit/ce0f41d40bc56acaa7ed606c86465f6dfec33d21))
* **kopilot:** show trailing working status during the multi-tool dead zone ([#768](https://github.com/Auxx-Ai/auxx-ai/issues/768)) ([0bb9347](https://github.com/Auxx-Ai/auxx-ai/commit/0bb9347713e3f533efff10217ae7c5ddf01fb38c))
* **procedures:** jsonb-stable content hash for procedure docs ([#762](https://github.com/Auxx-Ai/auxx-ai/issues/762)) ([1ed5b5f](https://github.com/Auxx-Ai/auxx-ai/commit/1ed5b5f551f590e8d4bfac23992ab94e094221c0))
* **security:** org-scope the procedure authoring guard ([#765](https://github.com/Auxx-Ai/auxx-ai/issues/765)) ([3a60f19](https://github.com/Auxx-Ai/auxx-ai/commit/3a60f195a2b313e22c6f02592bfaf4d8ec5329ea))

## [0.1.155](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.154...auxx-v0.1.155) (2026-06-01)


### Bug Fixes

* **api:** install ca-certificates in runner stage for GeoLite2 download ([#716](https://github.com/Auxx-Ai/auxx-ai/issues/716)) ([79e83c3](https://github.com/Auxx-Ai/auxx-ai/commit/79e83c3c6fa7f243bb32152ef83e15f64b6b1ee9))
* **billing:** hide cancel-subscription dialog for Shopify-billed orgs ([#718](https://github.com/Auxx-Ai/auxx-ai/issues/718)) ([7b079de](https://github.com/Auxx-Ai/auxx-ai/commit/7b079decadd7491f6a62d8c50bfc8b29c2ed98cb))

## [0.1.154](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.153...auxx-v0.1.154) (2026-06-01)


### Bug Fixes

* **chat:** make geo entrypoint reachable in api and drop root via gosu for Railway volume ([#714](https://github.com/Auxx-Ai/auxx-ai/issues/714)) ([b206cd5](https://github.com/Auxx-Ai/auxx-ai/commit/b206cd5fce975ea00f50a0c163b00ccea976fbcd))

## [0.1.153](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.152...auxx-v0.1.153) (2026-06-01)


### Bug Fixes

* **auth:** resolve headers from ctx.headers in before hook ([#712](https://github.com/Auxx-Ai/auxx-ai/issues/712)) ([dd662b9](https://github.com/Auxx-Ai/auxx-ai/commit/dd662b93f2a024cea701d44ce484eb6a1b972d59))

## [0.1.152](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.151...auxx-v0.1.152) (2026-06-01)


### Bug Fixes

* **kb:** externalize imapflow/pino/thread-stream in container build ([#710](https://github.com/Auxx-Ai/auxx-ai/issues/710)) ([5664ccf](https://github.com/Auxx-Ai/auxx-ai/commit/5664ccf42f77c1d3fc0ff408e5cbde280cff8d37))

## [0.1.151](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.150...auxx-v0.1.151) (2026-06-01)


### Features

* **audit,billing:** activity-log UI + shopify per-seat billing fixes ([#706](https://github.com/Auxx-Ai/auxx-ai/issues/706)) ([23c821a](https://github.com/Auxx-Ai/auxx-ai/commit/23c821a97d1946a835350ec3015bacfc5631481e))
* **audit:** activity events across routers + session-revocation cache ([#707](https://github.com/Auxx-Ai/auxx-ai/issues/707)) ([e9c840c](https://github.com/Auxx-Ai/auxx-ai/commit/e9c840c02b80d79f831e0d5bc7f354c612e4fe71))
* **audit:** unified AuditLog table replacing AdminActionLog ([#704](https://github.com/Auxx-Ai/auxx-ai/issues/704)) ([762ce69](https://github.com/Auxx-Ai/auxx-ai/commit/762ce69fa7efb2467de8bea8955b72802545d4cc))
* **billing:** Shopify App Billing as a provider alongside Stripe ([#701](https://github.com/Auxx-Ai/auxx-ai/issues/701)) ([e241166](https://github.com/Auxx-Ai/auxx-ai/commit/e241166b6226d1f1d07e1d75d9a4e054d9de3bb0))
* **billing:** shopify billing follow-ups — expiring tokens, webhooks, agent limit ([#702](https://github.com/Auxx-Ai/auxx-ai/issues/702)) ([1223923](https://github.com/Auxx-Ai/auxx-ai/commit/1223923239a4fe685b6b707787e899342a306c03))
* **billing:** shopify per-seat usage drip via app events ([#705](https://github.com/Auxx-Ai/auxx-ai/issues/705)) ([1741f79](https://github.com/Auxx-Ai/auxx-ai/commit/1741f79146f022ab981efab3bff443985348501c))
* **billing:** shopify-aware plan CTAs + trim noisy install/claim logs ([#703](https://github.com/Auxx-Ai/auxx-ai/issues/703)) ([d69312f](https://github.com/Auxx-Ai/auxx-ai/commit/d69312fc08d7f5863fc66400d449dfe2f84dca87))
* **chat-widget:** channel audience policy (visitors/both/users) ([#693](https://github.com/Auxx-Ai/auxx-ai/issues/693)) ([dc8aa44](https://github.com/Auxx-Ai/auxx-ai/commit/dc8aa44787ef894fe0b3764f7d6c2f5862f577ee))
* **chat-widget:** dedicated AI section in settings ([#694](https://github.com/Auxx-Ai/auxx-ai/issues/694)) ([14bc3dd](https://github.com/Auxx-Ai/auxx-ai/commit/14bc3dda42e137aea93ad2f42409520bab030203))
* **chat-widget:** framework-specific setup snippets + JWT middleware fix ([#692](https://github.com/Auxx-Ai/auxx-ai/issues/692)) ([188ed59](https://github.com/Auxx-Ai/auxx-ai/commit/188ed59421ea277fdfdc42e59eece1348b3026b8))
* **chat-widget:** kb search + thread handoff control refactor ([#681](https://github.com/Auxx-Ai/auxx-ai/issues/681)) ([d8cb913](https://github.com/Auxx-Ai/auxx-ai/commit/d8cb913819ecc06f9fd7772d1ae1ca5dd4e739a0))
* **chat-widget:** live preview pane in settings + setup section ([#690](https://github.com/Auxx-Ai/auxx-ai/issues/690)) ([be03411](https://github.com/Auxx-Ai/auxx-ai/commit/be034115e11edf58de85445b322a4bcc21d532d1))
* **chat+drawers:** optimistic send refactor, attachment realtime, drawer action registry ([#682](https://github.com/Auxx-Ai/auxx-ai/issues/682)) ([8adf67c](https://github.com/Auxx-Ai/auxx-ai/commit/8adf67cd2c8693122a2c065570a2ffe6bad1d9cc))
* **chat:** admin handoff display UI (Phase 4b-i) ([#666](https://github.com/Auxx-Ai/auxx-ai/issues/666)) ([d40dd0d](https://github.com/Auxx-Ai/auxx-ai/commit/d40dd0dc90ec1254dde98a52654a9458dad3591b))
* **chat:** chat duty toggle + duty-aware UI (P4c) ([#668](https://github.com/Auxx-Ai/auxx-ai/issues/668)) ([00326d8](https://github.com/Auxx-Ai/auxx-ai/commit/00326d852be5472ffa3cb8f8b43dea0a4c2276f2))
* **chat:** floating, draggable widget window (P6) ([#670](https://github.com/Auxx-Ai/auxx-ai/issues/670)) ([390bec2](https://github.com/Auxx-Ai/auxx-ai/commit/390bec2cfd295aa3592ec8f5fd38f381cfe2c84c))
* **chat:** friendly visitor labels (Chat user #xxxx) ([#673](https://github.com/Auxx-Ai/auxx-ai/issues/673)) ([366c570](https://github.com/Auxx-Ai/auxx-ai/commit/366c570130df2fe3525a96ea340c15e37844108f))
* **chat:** group consecutive same-sender chat bubbles ([#647](https://github.com/Auxx-Ai/auxx-ai/issues/647)) ([e8bf2ef](https://github.com/Auxx-Ai/auxx-ai/commit/e8bf2efef7aafad92156f5815565e840d6347ca3))
* **chat:** identity rotation guard + cross-device thread ownership ([#697](https://github.com/Auxx-Ai/auxx-ai/issues/697)) ([517c149](https://github.com/Auxx-Ai/auxx-ai/commit/517c14938cc1b9bf4ad503d956160e9634fdbc19))
* **chat:** lazy attachment URLs, paginated history, visitor label cleanup ([#679](https://github.com/Auxx-Ai/auxx-ai/issues/679)) ([83286b6](https://github.com/Auxx-Ai/auxx-ai/commit/83286b6fa20f9c6037da1ecec575932785c60fa5))
* **chat:** org presence + widget polish ([#674](https://github.com/Auxx-Ai/auxx-ai/issues/674)) ([0a6dd41](https://github.com/Auxx-Ai/auxx-ai/commit/0a6dd415ad719489fb67345dc62ddd9eb5a33ad7))
* **chat:** promote chat-widget to @auxx/chat npm package ([#688](https://github.com/Auxx-Ai/auxx-ai/issues/688)) ([d644065](https://github.com/Auxx-Ai/auxx-ai/commit/d64406567b71da3ee040d5cbe3a629ed861e066c))
* **chat:** shopify app proxy jwt mint + visitor geo + friendly handles ([#699](https://github.com/Auxx-Ai/auxx-ai/issues/699)) ([52d87e2](https://github.com/Auxx-Ai/auxx-ai/commit/52d87e225ddeb8526207718532e107e59b4ecc5a))
* **chat:** thread events + realtime publish (P4.3) ([#664](https://github.com/Auxx-Ai/auxx-ai/issues/664)) ([34b98ae](https://github.com/Auxx-Ai/auxx-ai/commit/34b98aeb0c07a0d837bfad1086f45f33ffd61e72))
* **chat:** thread handoff state + take over button (P4.2) ([#663](https://github.com/Auxx-Ai/auxx-ai/issues/663)) ([b8bab3f](https://github.com/Auxx-Ai/auxx-ai/commit/b8bab3f5f3d139f7c1e190e4ca150dcdf9e86c88))
* **chat:** tinted token system + clearable header color ([#672](https://github.com/Auxx-Ai/auxx-ai/issues/672)) ([7ff3f44](https://github.com/Auxx-Ai/auxx-ai/commit/7ff3f4483c2eefd008c51cb99004bb74c47d6aa9))
* **chat:** v4 — @auxx/chat npm boot API + JWT identity verification ([#689](https://github.com/Auxx-Ai/auxx-ai/issues/689)) ([65d4265](https://github.com/Auxx-Ai/auxx-ai/commit/65d42653ebb5cc13d21105a644fe808e8271274f))
* **chat:** welcome bubble + agent identity (P4.1) ([#667](https://github.com/Auxx-Ai/auxx-ai/issues/667)) ([dc9d439](https://github.com/Auxx-Ai/auxx-ai/commit/dc9d439d9d8c54e577cae6d2f6119efbad14e1cd))
* **chat:** widget dark mode ([#655](https://github.com/Auxx-Ai/auxx-ai/issues/655)) ([5f3833b](https://github.com/Auxx-Ai/auxx-ai/commit/5f3833b7043dcb9a822d4a79c957bf1f6db8beb9))
* **chat:** widget Home hero, header color, thread-only expand ([#654](https://github.com/Auxx-Ai/auxx-ai/issues/654)) ([48ad9d5](https://github.com/Auxx-Ai/auxx-ai/commit/48ad9d5360815801095a9c9829521950c1f30373))
* **chat:** widget logos, rate limits, /threads/:id/messages route ([#652](https://github.com/Auxx-Ai/auxx-ai/issues/652)) ([3fbf347](https://github.com/Auxx-Ai/auxx-ai/commit/3fbf34730fe046cc8b08a53669b33f3fabac99af))
* **chat:** widget privacy banner + thread tombstones, shell polish ([#658](https://github.com/Auxx-Ai/auxx-ai/issues/658)) ([3f4400b](https://github.com/Auxx-Ai/auxx-ai/commit/3f4400bcac6f92b865c0f83e6573c0f150fbf326))
* **chat:** widget renders thread events (P4.4) ([#665](https://github.com/Auxx-Ai/auxx-ai/issues/665)) ([71f64f5](https://github.com/Auxx-Ai/auxx-ai/commit/71f64f5b501cac83a4d96fe0c4928f6481b35b9d))
* **chat:** widget suggested replies + KB markdown polish ([#657](https://github.com/Auxx-Ai/auxx-ai/issues/657)) ([4c633d9](https://github.com/Auxx-Ai/auxx-ai/commit/4c633d97c5212c488a80026bf96438e8cdd2deb0))
* **chat:** widget v2 Home tab — greeting, KB cards, recent message ([#649](https://github.com/Auxx-Ai/auxx-ai/issues/649)) ([e36f474](https://github.com/Auxx-Ai/auxx-ai/commit/e36f4746bd9ee1aab393c2aa2c554980c084f967))
* **chat:** widget v2 KB tab — section browse + article reader ([#650](https://github.com/Auxx-Ai/auxx-ai/issues/650)) ([5f8bc6b](https://github.com/Auxx-Ai/auxx-ai/commit/5f8bc6b9ee981631d07484adf19cdd53ed29438d))
* **chat:** widget v2 Messages tab, conversation view, visitor channel ([#651](https://github.com/Auxx-Ai/auxx-ai/issues/651)) ([d693809](https://github.com/Auxx-Ai/auxx-ai/commit/d6938090c15583052cf91918d1b887e468527816))
* **chat:** widget v2 schema, identify() API, and agent ChatPanel ([#648](https://github.com/Auxx-Ai/auxx-ai/issues/648)) ([fb51a17](https://github.com/Auxx-Ai/auxx-ai/commit/fb51a17b1d2640c1eb80ff48daeba4cc6bececbc))
* **geo:** visitor city for chat widget + shopify reserved-namespace metafields ([#698](https://github.com/Auxx-Ai/auxx-ai/issues/698)) ([67b1674](https://github.com/Auxx-Ai/auxx-ai/commit/67b1674d1d4e01929c2c428e7d9140998821557e))
* **homepage:** default to light theme + gradient card polish ([#677](https://github.com/Auxx-Ai/auxx-ai/issues/677)) ([d43df43](https://github.com/Auxx-Ai/auxx-ai/commit/d43df4392ec1891afb27f61cef21ebdc3646474f))
* **homepage:** hero v2 with kopilot mock + 3D overflow support ([#676](https://github.com/Auxx-Ai/auxx-ai/issues/676)) ([31dee74](https://github.com/Auxx-Ai/auxx-ai/commit/31dee743738455bacea3041668d2c936a5172cde))
* **inbox:** treat inbox as entity (visual ref, picker fix, drop bespoke router) ([#685](https://github.com/Auxx-Ai/auxx-ai/issues/685)) ([e91408d](https://github.com/Auxx-Ai/auxx-ai/commit/e91408d8239ec196aa27675f557b1457c54850d0))
* **ingest+compose:** inbox sync-completed event, serial batch drain, default channel picker ([#683](https://github.com/Auxx-Ai/auxx-ai/issues/683)) ([44a60dc](https://github.com/Auxx-Ai/auxx-ai/commit/44a60dcceb27aa73e9763cc3006a1c0a1e0dcd79))
* **kopilot:** app icons on tool pills + agent UI polish ([#638](https://github.com/Auxx-Ai/auxx-ai/issues/638)) ([8f50770](https://github.com/Auxx-Ai/auxx-ai/commit/8f507709315245e52f51af8b13e13848a4370aec))
* **mail:** participant drawer + thread-header participant chip ([#686](https://github.com/Auxx-Ai/auxx-ai/issues/686)) ([cfe491c](https://github.com/Auxx-Ai/auxx-ai/commit/cfe491cf3e50ad07d297ec7791b220ff67111374))
* **threads:** denormalize merge state into mergeData jsonb ([#696](https://github.com/Auxx-Ai/auxx-ai/issues/696)) ([50156cd](https://github.com/Auxx-Ai/auxx-ai/commit/50156cd1721a130bfc080835300d3746808627e7))
* **threads:** soft-merge with 24h unmerge window ([#695](https://github.com/Auxx-Ai/auxx-ai/issues/695)) ([e4a3fb5](https://github.com/Auxx-Ai/auxx-ai/commit/e4a3fb5366ae0d369f4360c6900e5861c5ee9a36))


### Bug Fixes

* **build:** declare imapflow/pino/thread-stream as direct deps of @auxx/build ([#709](https://github.com/Auxx-Ai/auxx-ai/issues/709)) ([ead6be1](https://github.com/Auxx-Ai/auxx-ai/commit/ead6be14b7555bdf92272a0baefdda5ddd16dcec))
* **build:** resolve container build failures across homepage, build, chat ([#708](https://github.com/Auxx-Ai/auxx-ai/issues/708)) ([99b70a5](https://github.com/Auxx-Ai/auxx-ai/commit/99b70a5f936af8d027baeec9a79bea9bc18b200d))
* **chat:** P4 realtime + reconcile fixes ([#669](https://github.com/Auxx-Ai/auxx-ai/issues/669)) ([980b1b5](https://github.com/Auxx-Ai/auxx-ai/commit/980b1b51861f8500a2a0c6d8e8626252b51db309))
* **chat:** prevent workspace-only @auxx/* leaking into published dist ([#691](https://github.com/Auxx-Ai/auxx-ai/issues/691)) ([cb484ab](https://github.com/Auxx-Ai/auxx-ai/commit/cb484abf7f74c400e81c3709120d9b99f57db3d6))
* **chat:** visitor label + snippets in inbox, widget polish ([#675](https://github.com/Auxx-Ai/auxx-ai/issues/675)) ([35d815a](https://github.com/Auxx-Ai/auxx-ai/commit/35d815a89bd458119148c2da24f8d5df0d11dfcf))
* **homepage:** hide kopilot mock on mobile, refactor tilt classes ([#678](https://github.com/Auxx-Ai/auxx-ai/issues/678)) ([830ba4b](https://github.com/Auxx-Ai/auxx-ai/commit/830ba4ba18032b8d369e2dabb6c0625159c192d4))
* **homepage:** paginated mobile logo cloud, hero blur, looping kopilot ([#680](https://github.com/Auxx-Ai/auxx-ai/issues/680)) ([ece8c6b](https://github.com/Auxx-Ai/auxx-ai/commit/ece8c6b8fe4c6d6b68448c096a405f9883e74fc0))
* **signatures:** prefix systemAttributes + fix appendSignature + backfill ([#684](https://github.com/Auxx-Ai/auxx-ai/issues/684)) ([5f61621](https://github.com/Auxx-Ai/auxx-ai/commit/5f61621aaa3d84bd73d83c49708c809e15dcc699))
* visible turnstile + correct agentId in kopilot stream ([#636](https://github.com/Auxx-Ai/auxx-ai/issues/636)) ([5dd2a7b](https://github.com/Auxx-Ai/auxx-ai/commit/5dd2a7bab583a6fc5844af58d71885080b526a42))
* **widget+picker:** reset widget storage, opt-out badge hover card ([#687](https://github.com/Auxx-Ai/auxx-ai/issues/687)) ([35e7aef](https://github.com/Auxx-Ai/auxx-ai/commit/35e7aef861d427e448e68e265b366730f24726a1))
* **workflow:** AI v2 nodes — built-in capabilities + explicit appAccounts ([#662](https://github.com/Auxx-Ai/auxx-ai/issues/662)) ([556f7d6](https://github.com/Auxx-Ai/auxx-ai/commit/556f7d632fc330fcb09253e93ae7212e6aa9dba6))

## [0.1.150](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.149...auxx-v0.1.150) (2026-05-20)


### Features

* **shopify:** app-store-initiated install with claim flow ([#634](https://github.com/Auxx-Ai/auxx-ai/issues/634)) ([524efca](https://github.com/Auxx-Ai/auxx-ai/commit/524efca56ba76816d14febd8f9a47c7ac3e8673d))

## [0.1.149](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.148...auxx-v0.1.149) (2026-05-20)


### Features

* **agents:** app-kind triggers in agent UI ([#633](https://github.com/Auxx-Ai/auxx-ai/issues/633)) ([fced871](https://github.com/Auxx-Ai/auxx-ai/commit/fced8718d727b6427e05317cad584a87618dc33b))
* **app-surface:** unified tool registry + catalog envelope ([#629](https://github.com/Auxx-Ai/auxx-ai/issues/629)) ([9bec05d](https://github.com/Auxx-Ai/auxx-ai/commit/9bec05d94000fd657a23c985e9b416b2bc521249))


### Bug Fixes

* **sdk:** make WorkflowExecuteFunction ctx required ([#632](https://github.com/Auxx-Ai/auxx-ai/issues/632)) ([08e3156](https://github.com/Auxx-Ai/auxx-ai/commit/08e3156b3804808c84af2c7396c444098d90ef9c))
* **sdk:** widen WorkflowExecuteFunction with ctx + add toolMap ([#631](https://github.com/Auxx-Ai/auxx-ai/issues/631)) ([dfc856e](https://github.com/Auxx-Ai/auxx-ai/commit/dfc856e218984487d69bd3ecb6b4645e60723ff7))

## [0.1.148](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.147...auxx-v0.1.148) (2026-05-19)


### Features

* **agents:** autonomous agent triggers (scheduled, event, app) ([#601](https://github.com/Auxx-Ai/auxx-ai/issues/601)) ([f3e9ebe](https://github.com/Auxx-Ai/auxx-ai/commit/f3e9ebe8ec84f2cad989b1aab1984af7f9ce8d8f))
* **agents:** builder chat capabilities + suggest-replies chips ([#597](https://github.com/Auxx-Ai/auxx-ai/issues/597)) ([92d8138](https://github.com/Auxx-Ai/auxx-ai/commit/92d8138debe2a79dc17b471486a43b772ed01c47))
* **agents:** builder domain pins SYSTEM model + trigger dialog rewrite ([#603](https://github.com/Auxx-Ai/auxx-ai/issues/603)) ([90519d9](https://github.com/Auxx-Ai/auxx-ai/commit/90519d96d7f5557a99e994bf82ff377c953e1a46))
* **agents:** builder kopilot — markdown prompts, triggers tool, server-side setup guard ([#604](https://github.com/Auxx-Ai/auxx-ai/issues/604)) ([f50ca33](https://github.com/Auxx-Ai/auxx-ai/commit/f50ca332b1a7ee09fca3fa93424c4efd7ae6258a))
* **agents:** chat-driven setup mode + slug rename + draft cleanup ([#602](https://github.com/Auxx-Ai/auxx-ai/issues/602)) ([0a4051b](https://github.com/Auxx-Ai/auxx-ai/commit/0a4051b8cabe20812cd737401a3348258b7e605d))
* **agents:** command-based app account picker + orphan binding cleanup ([#624](https://github.com/Auxx-Ai/auxx-ai/issues/624)) ([36c74b9](https://github.com/Auxx-Ai/auxx-ai/commit/36c74b9d3f39d2e51e1df5805898b5aff9620d19))
* **agents:** contact lookup SDK callbacks + agent trigger fanout ([#627](https://github.com/Auxx-Ai/auxx-ai/issues/627)) ([3ded443](https://github.com/Auxx-Ai/auxx-ai/commit/3ded443e3f072619c6a5d4896b7995cd3c2a2d47))
* **agents:** defer synthetic User row until setup completes ([#620](https://github.com/Auxx-Ai/auxx-ai/issues/620)) ([19dccc0](https://github.com/Auxx-Ai/auxx-ai/commit/19dccc0af9365caf20c9c06ab5d71c20aab3f156))
* **agents:** dispatch triggers from org cache instead of DB ([#621](https://github.com/Auxx-Ai/auxx-ai/issues/621)) ([9ab76e0](https://github.com/Auxx-Ai/auxx-ai/commit/9ab76e0aca53c9a46ff4d7b1f402879aecef0039))
* **agents:** dm trigger kind + Chat tab + composer sender picker ([#619](https://github.com/Auxx-Ai/auxx-ai/issues/619)) ([76e78c1](https://github.com/Auxx-Ai/auxx-ai/commit/76e78c14f3fea56de39e43aaf9d7fddd9fca0a6a))
* **agents:** grouped tools tab + unified knowledge scope tree ([#596](https://github.com/Auxx-Ai/auxx-ai/issues/596)) ([05efa74](https://github.com/Auxx-Ai/auxx-ai/commit/05efa749170f981b3ee3b515e0f91a91c19a7ba0))
* **agents:** hover-revealed trash for installed tools tree ([#610](https://github.com/Auxx-Ai/auxx-ai/issues/610)) ([2034b25](https://github.com/Auxx-Ai/auxx-ai/commit/2034b257f8f9c4939518ce642ce86a0b9828849c))
* **agents:** per-agent app account bindings + apps refactor ([#622](https://github.com/Auxx-Ai/auxx-ai/issues/622)) ([6bbf8d7](https://github.com/Auxx-Ai/auxx-ai/commit/6bbf8d7f8258dff1554f87931d2932bd55a95e00))
* **agents:** persona editor with shared rich-text + inline references ([#593](https://github.com/Auxx-Ai/auxx-ai/issues/593)) ([ecdf341](https://github.com/Auxx-Ai/auxx-ai/commit/ecdf3413972825e5c98d035f0c3a0ee99e33cadb))
* **agents:** phase 1 CRUD routers, toolset resolution, runtime wiring ([#591](https://github.com/Auxx-Ai/auxx-ai/issues/591)) ([52994a9](https://github.com/Auxx-Ai/auxx-ai/commit/52994a9cda5b05ad31dd34338e45994362f75462))
* **agents:** phase 1 UI — tools + knowledge tabs ([#595](https://github.com/Auxx-Ai/auxx-ai/issues/595)) ([87e61b9](https://github.com/Auxx-Ai/auxx-ai/commit/87e61b92e00b6a75981edcddd19e2180716bf4b7))
* **agents:** phase 2 admin UI + service-layer refactor ([#592](https://github.com/Auxx-Ai/auxx-ai/issues/592)) ([de50e2e](https://github.com/Auxx-Ai/auxx-ai/commit/de50e2ecb34a0f73b80de5338ed616f4e6edcbc1))
* **agents:** phase 2 UI — builder chat, toolset tree, persona editor polish ([9e423d0](https://github.com/Auxx-Ai/auxx-ai/commit/9e423d06ec364b420b2225124740c7439477f228))
* **agents:** realtime agent:updated event replaces tool-output rail signal ([#625](https://github.com/Auxx-Ai/auxx-ai/issues/625)) ([e67a874](https://github.com/Auxx-Ai/auxx-ai/commit/e67a874732087084bbf0450e3a8f67fa4a18e88d))
* **agents:** rich-text instructions in trigger dialog ([#623](https://github.com/Auxx-Ai/auxx-ai/issues/623)) ([ee523ce](https://github.com/Auxx-Ai/auxx-ai/commit/ee523ce537f8fff078fe075b93d1281e0b14b891))
* **agents:** schema chips in personas + 32K output-token defaults ([#612](https://github.com/Auxx-Ai/auxx-ai/issues/612)) ([a3604a3](https://github.com/Auxx-Ai/auxx-ai/commit/a3604a34433a67ec0561922e42371f8205563dca))
* **agents:** single-row agent + unified app catalog ([#608](https://github.com/Auxx-Ai/auxx-ai/issues/608)) ([05a101d](https://github.com/Auxx-Ai/auxx-ai/commit/05a101d3f117fff27e4d25e2238078e81244cf57))
* **agents:** tool refs in personas + autonomous-run prompt + dynamic capability gating ([#606](https://github.com/Auxx-Ai/auxx-ai/issues/606)) ([5cc829d](https://github.com/Auxx-Ai/auxx-ai/commit/5cc829d4d35f4cc64bef5a93df23fea01f5bfd50))
* **agents:** tool-select dialog with popular curation ([#609](https://github.com/Auxx-Ai/auxx-ai/issues/609)) ([60ea108](https://github.com/Auxx-Ai/auxx-ai/commit/60ea1087d1fee6f987a6041d00768ea08ab052d3))
* **agents:** v1 schema, services, and actor integration ([#589](https://github.com/Auxx-Ai/auxx-ai/issues/589)) ([685af7b](https://github.com/Auxx-Ai/auxx-ai/commit/685af7b3a9a2fd50152deea5b2ba6ffdf62ab61b))
* **apps:** personal + workspace connection scopes, member visibility ([#599](https://github.com/Auxx-Ai/auxx-ai/issues/599)) ([645a5d0](https://github.com/Auxx-Ai/auxx-ai/commit/645a5d0058ff896e1c455fcdb608da059f40493e))
* **apps:** rename SDK ai surface to tools + drop per-call approval ([#626](https://github.com/Auxx-Ai/auxx-ai/issues/626)) ([5aedfad](https://github.com/Auxx-Ai/auxx-ai/commit/5aedfad40c24b7136df051992b359228604353ba))
* **articles:** add slug/excerpt/emoji/color/archive/publish fields + parent↔children inverse ([#594](https://github.com/Auxx-Ai/auxx-ai/issues/594)) ([0198cf5](https://github.com/Auxx-Ai/auxx-ai/commit/0198cf568d36bcf97dec50b95a0da27bd729bc97))
* **comments+agents:** tiptap-json comments with references + assignment/mention triggers ([#605](https://github.com/Auxx-Ai/auxx-ai/issues/605)) ([45744b3](https://github.com/Auxx-Ai/auxx-ai/commit/45744b3df53911b84399857d1beda7c6edbd9cb6))
* **editor:** shared slash-commands module + persona bubble menu ([#607](https://github.com/Auxx-Ai/auxx-ai/issues/607)) ([2c80485](https://github.com/Auxx-Ai/auxx-ai/commit/2c8048503a79fc66da8638903aef55be8c5d493f))
* **favorites:** articles & knowledge bases + KB articles search bar ([#587](https://github.com/Auxx-Ai/auxx-ai/issues/587)) ([4e9e94b](https://github.com/Auxx-Ai/auxx-ai/commit/4e9e94bc17ec6cdcc0e6470086d3c7afda37a8a5))
* **kb-admin:** article status dots + breadcrumb KB switcher ([#585](https://github.com/Auxx-Ai/auxx-ai/issues/585)) ([27f3d34](https://github.com/Auxx-Ai/auxx-ai/commit/27f3d34031a9ccb08ccf62abc520c4d24984aa1c))
* **kb:** cacheComponents Suspense fix, no-flash dark mode, 12-step palette ([#583](https://github.com/Auxx-Ai/auxx-ai/issues/583)) ([cdedc53](https://github.com/Auxx-Ai/auxx-ai/commit/cdedc5346c5aa9004c4663d3acc827856de8c96e))
* **kopilot:** ai tools wedge a — SDK tool definitions + runtime bridge ([#598](https://github.com/Auxx-Ai/auxx-ai/issues/598)) ([23bc604](https://github.com/Auxx-Ai/auxx-ai/commit/23bc604b028e7def183558cc7ad27b01e5925350))
* **kopilot:** lambda streaming response probe (spike) ([#588](https://github.com/Auxx-Ai/auxx-ai/issues/588)) ([61c19e3](https://github.com/Auxx-Ai/auxx-ai/commit/61c19e3b5c324d7e6d9505b9a9c07dd59f278b65))
* **kopilot:** master Kopilot settings (model, toolsets, app accounts) ([#628](https://github.com/Auxx-Ai/auxx-ai/issues/628)) ([38c2c3d](https://github.com/Auxx-Ai/auxx-ai/commit/38c2c3d654cb615c22031c8c02db026a89a0751d))
* **kopilot:** one-message-per-turn with content-block parts ([#615](https://github.com/Auxx-Ai/auxx-ai/issues/615)) ([0e95849](https://github.com/Auxx-Ai/auxx-ai/commit/0e95849dd9ab578daf9350a78f0cdefbbf000339))
* **kopilot:** oneshot query mode + collapsible block cards ([#616](https://github.com/Auxx-Ai/auxx-ai/issues/616)) ([26f7134](https://github.com/Auxx-Ai/auxx-ai/commit/26f71343f01445d663ac2b824fe5254092721820))
* **kopilot:** Phase 0 — prompt split + toolset tagging ([#590](https://github.com/Auxx-Ai/auxx-ai/issues/590)) ([2daad7a](https://github.com/Auxx-Ai/auxx-ai/commit/2daad7a39043cbe42f63a385feadbb175aa25946))
* **kopilot:** rename resource: chips to entity: + rich template previews ([#618](https://github.com/Auxx-Ai/auxx-ai/issues/618)) ([b4ce797](https://github.com/Auxx-Ai/auxx-ai/commit/b4ce7976144b06cb4486776c5e197d201f3e09f4))
* **kopilot:** rich-text prompt templates with reference chips ([#617](https://github.com/Auxx-Ai/auxx-ai/issues/617)) ([9b3c7db](https://github.com/Auxx-Ai/auxx-ai/commit/9b3c7dbcf79abd1855bf0d1fae35be62625760ee))
* **kopilot:** section-registry prompt builder + multi-tier prompt caching ([#611](https://github.com/Auxx-Ai/auxx-ai/issues/611)) ([80f7ef6](https://github.com/Auxx-Ai/auxx-ai/commit/80f7ef647c5e4cd9669774abcac0d9c6dfcbdc39))
* **kopilot:** smooth streaming text + partial-JSON block rendering ([#613](https://github.com/Auxx-Ai/auxx-ai/issues/613)) ([fb19f32](https://github.com/Auxx-Ai/auxx-ai/commit/fb19f325c834bec6ed07c57ebecefc36a2d4b9fd))
* **workflows:** wire entity/company/stock/vendor events to workflow triggers ([#600](https://github.com/Auxx-Ai/auxx-ai/issues/600)) ([4f1d833](https://github.com/Auxx-Ai/auxx-ai/commit/4f1d8332ef335bebcdb338b5a52ec4d8f5db275d))


### Bug Fixes

* **homepage:** clip hero illustration horizontal overflow ([#614](https://github.com/Auxx-Ai/auxx-ai/issues/614)) ([2df1e27](https://github.com/Auxx-Ai/auxx-ai/commit/2df1e27cb5d3ab9a55a441aa411cdbf4f587de83))

## [0.1.147](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.146...auxx-v0.1.147) (2026-05-13)


### Features

* **kb:** short-circuit DB calls for cacheComponents build stub ([86ae218](https://github.com/Auxx-Ai/auxx-ai/commit/86ae21898f743c58323283463df22d75faadc5ad))

## [0.1.146](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.145...auxx-v0.1.146) (2026-05-13)


### Features

* **kb:** add tailwind v4 postcss setup so docker build succeeds ([7d23f3e](https://github.com/Auxx-Ai/auxx-ai/commit/7d23f3e18b28a83f73a9a03528abf0bc0ffe68b5))

## [0.1.145](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.144...auxx-v0.1.145) (2026-05-13)


### Features

* update page ([3d8ff6c](https://github.com/Auxx-Ai/auxx-ai/commit/3d8ff6c31267dac22af14d5a7fa394bd188c85b9))

## [0.1.144](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.143...auxx-v0.1.144) (2026-05-13)


### Features

* **homepage:** data-model ingestion-flow section + dark surface cards ([#563](https://github.com/Auxx-Ai/auxx-ai/issues/563)) ([d10dfc9](https://github.com/Auxx-Ai/auxx-ai/commit/d10dfc9e048fa095f66646de74c41e71ef238439))
* **homepage:** data-model polish + managed datasets excluded from limits ([#556](https://github.com/Auxx-Ai/auxx-ai/issues/556)) ([b655b4c](https://github.com/Auxx-Ai/auxx-ai/commit/b655b4c122b840aa8551916ad2fb0bc445891cc2))
* **homepage:** hero illustration with video modal, kopilot/ingestion sections ([#574](https://github.com/Auxx-Ai/auxx-ai/issues/574)) ([2d38ee8](https://github.com/Auxx-Ai/auxx-ai/commit/2d38ee8aaa3f2426ef0dfe13301734782c063bb7))
* **homepage:** kb surfaces carousel on data-model page ([#554](https://github.com/Auxx-Ai/auxx-ai/issues/554)) ([0544aac](https://github.com/Auxx-Ai/auxx-ai/commit/0544aac639ae20944cee4b29506c8ef6fb13f27c))
* **homepage:** kopilot agents CTA section ([#557](https://github.com/Auxx-Ai/auxx-ai/issues/557)) ([aad1bc4](https://github.com/Auxx-Ai/auxx-ai/commit/aad1bc4e984b1e1e01a1dfb4fc5d0a0126b37c2b))
* **homepage:** messaging hero shader bg + KB platform assets ([#553](https://github.com/Auxx-Ai/auxx-ai/issues/553)) ([8a92c70](https://github.com/Auxx-Ai/auxx-ai/commit/8a92c70b9a12bbe2fbaa9712c0565dbba49a6f87))
* **homepage:** modular kopilot mocks + scripted prompt stories ([#549](https://github.com/Auxx-Ai/auxx-ai/issues/549)) ([4bdebc4](https://github.com/Auxx-Ai/auxx-ai/commit/4bdebc49caccfa111a25437fd6fed23e455fdff9))
* **homepage:** platform/ai/kopilot + data-model pages ([#547](https://github.com/Auxx-Ai/auxx-ai/issues/547)) ([4a60b0a](https://github.com/Auxx-Ai/auxx-ai/commit/4a60b0ae47cbf3b8a41742e31851e15b58dad4f2))
* **homepage:** shader gradient backgrounds + section fades ([#551](https://github.com/Auxx-Ai/auxx-ai/issues/551)) ([38f458b](https://github.com/Auxx-Ai/auxx-ai/commit/38f458bcbd4983157e623914945d756b9d993ff6))
* **kb:** admin preview tab clicks + logo empty-string fix ([#536](https://github.com/Auxx-Ai/auxx-ai/issues/536)) ([490eded](https://github.com/Auxx-Ai/auxx-ai/commit/490eded34c36bb422d637dfff866c423fa549f09))
* **kb:** array-shape contentJson + block IDs on tables/tabs/accordion ([#570](https://github.com/Auxx-Ai/auxx-ai/issues/570)) ([ec58146](https://github.com/Auxx-Ai/auxx-ai/commit/ec58146ca07ca7d44eee2de6f0e7f84afe9c1b68))
* **kb:** article entity, tag scoping, cover image, AI toggle ([#567](https://github.com/Auxx-Ai/auxx-ai/issues/567)) ([6658512](https://github.com/Auxx-Ai/auxx-ai/commit/66585123f25cd8ca182e2021c137a1faf526e541))
* **kb:** article kinds + tab strip ([#528](https://github.com/Auxx-Ai/auxx-ai/issues/528)) ([5d50764](https://github.com/Auxx-Ai/auxx-ai/commit/5d5076403484c00f1d889def0b113b4f160d6d8e))
* **kb:** articles list view, kb resource registry, picker fixes ([#577](https://github.com/Auxx-Ai/auxx-ai/issues/577)) ([bd14eeb](https://github.com/Auxx-Ai/auxx-ai/commit/bd14eeb094b0e9eee7045f62c3e7ddec52474588))
* **kb:** cards block + auxx:// internal link scheme + preview version picker ([#541](https://github.com/Auxx-Ai/auxx-ai/issues/541)) ([e6dd68b](https://github.com/Auxx-Ai/auxx-ai/commit/e6dd68b9ee6bc041b18464e0f485d5f4457909a1))
* **kb:** collapsible TOC rail, h4 in TOC, sticky-aware scroll-margin ([#550](https://github.com/Auxx-Ai/auxx-ai/issues/550)) ([3ed622d](https://github.com/Auxx-Ai/auxx-ai/commit/3ed622d45463f01005c5c169a3252b9f0fa5fec2))
* **kb:** cookie mode persistence + sidebar header cleanup + editor polish ([#542](https://github.com/Auxx-Ai/auxx-ai/issues/542)) ([cd57189](https://github.com/Auxx-Ai/auxx-ai/commit/cd571893da047f3569b17f46e9f018d906f514da))
* **kb:** draft settings layer with autosave + publish/discard ([#525](https://github.com/Auxx-Ai/auxx-ai/issues/525)) ([6a709a0](https://github.com/Auxx-Ai/auxx-ai/commit/6a709a0c9bfe557f83687513defd4272269ecc2f))
* **kb:** draft/published envelopes, originator-tagged resync, shared editor sync ([#573](https://github.com/Auxx-Ai/auxx-ai/issues/573)) ([8f3023c](https://github.com/Auxx-Ai/auxx-ai/commit/8f3023c7d43f83e1fe1e25afd04b7f7eaa281f08))
* **kb:** editor bubble menu, list-style attr, container placeholders, live badge ([#572](https://github.com/Auxx-Ai/auxx-ai/issues/572)) ([7c4d918](https://github.com/Auxx-Ai/auxx-ai/commit/7c4d918eefa847dd3934b7e8a3a2a3ca1954064d))
* **kb:** editor chrome refactor + unified publish cluster ([#526](https://github.com/Auxx-Ai/auxx-ai/issues/526)) ([c0dc639](https://github.com/Auxx-Ai/auxx-ai/commit/c0dc639c6cd521d0508487d5b5bc0410128204b6))
* **kb:** editor enter-to-advance, public cover uploads, header layout ([#568](https://github.com/Auxx-Ai/auxx-ai/issues/568)) ([407c140](https://github.com/Auxx-Ai/auxx-ai/commit/407c1402809ff68a02e5c9bd55b53a39e3d79d69))
* **kb:** editor paste, code block, and tabs polish ([#552](https://github.com/Auxx-Ai/auxx-ai/issues/552)) ([6c9d9a1](https://github.com/Auxx-Ai/auxx-ai/commit/6c9d9a12a928f5853213026f5ebf9230f04ee813))
* **kb:** fractional sort order + tab DnD + ancestor publish cascade ([#529](https://github.com/Auxx-Ai/auxx-ai/issues/529)) ([266a5a4](https://github.com/Auxx-Ai/auxx-ai/commit/266a5a49c231c2245ecb8e95b92402be3d6fd157))
* **kb:** internal visibility + custom-domain verification + auth flow ([#522](https://github.com/Auxx-Ai/auxx-ai/issues/522)) ([c34f755](https://github.com/Auxx-Ai/auxx-ai/commit/c34f7558b11a19bfe1461b1ea070c5a3f17a1e47))
* **kb:** kopilot block-level article editing with realtime sync and per-turn undo ([#569](https://github.com/Auxx-Ai/auxx-ai/issues/569)) ([4589442](https://github.com/Auxx-Ai/auxx-ai/commit/4589442bb0e239092d2fbc80edaaac30895206c7))
* **kb:** link article kind for external URL sidebar entries ([#538](https://github.com/Auxx-Ai/auxx-ai/issues/538)) ([7c48f40](https://github.com/Auxx-Ai/auxx-ai/commit/7c48f40a4fd655509946a4eabd874ad8a40abff6))
* **kb:** link context menu + kb-switcher delete + kopilot scroll fix ([#544](https://github.com/Auxx-Ai/auxx-ai/issues/544)) ([5edc80d](https://github.com/Auxx-Ai/auxx-ai/commit/5edc80d609182476cf995ef26bb81b493788c0e7))
* **kb:** managed dataset sync + drop legacy embeddings stack ([#527](https://github.com/Auxx-Ai/auxx-ai/issues/527)) ([0db70b0](https://github.com/Auxx-Ai/auxx-ai/commit/0db70b06edac19f6b6d401be17303f7b113a6699))
* **kb:** markdown import/export, preview device frames, mobile TOC drawer ([#523](https://github.com/Auxx-Ai/auxx-ai/issues/523)) ([62738f3](https://github.com/Auxx-Ai/auxx-ai/commit/62738f3107cbc31bfef59ac230e92e727af921ab))
* **kb:** nested callout frame, plaintext paste, mod-a scoping ([#555](https://github.com/Auxx-Ai/auxx-ai/issues/555)) ([5cd0f50](https://github.com/Auxx-Ai/auxx-ai/commit/5cd0f507f15587867cca85cc1455072cdb43b724))
* **kb:** optional tabs + headers in URLs + container delete promotes children ([#530](https://github.com/Auxx-Ai/auxx-ai/issues/530)) ([73d1b86](https://github.com/Auxx-Ai/auxx-ai/commit/73d1b86234285880ff42532219cb809244b89a9b))
* **kb:** plain-markdown article URLs at /&lt;slug&gt;.md + copy menu ([#535](https://github.com/Auxx-Ai/auxx-ai/issues/535)) ([fa3a33c](https://github.com/Auxx-Ai/auxx-ai/commit/fa3a33c48d5b91d615edd33c338fb3d0bdb44306))
* **kb:** preview hint nudge to Articles tab, gate Layout tab, settings shuffle ([#566](https://github.com/Auxx-Ai/auxx-ai/issues/566)) ([9fe9496](https://github.com/Auxx-Ai/auxx-ai/commit/9fe9496ae5c28ddfe9551bac186270a54154c223))
* **kb:** preview mode override + shared banner ([#533](https://github.com/Auxx-Ai/auxx-ai/issues/533)) ([f89b421](https://github.com/Auxx-Ai/auxx-ai/commit/f89b421f9a5f9bb47667e04d42047f1c685c9d5a))
* **kb:** publishing workflow + article versioning (phase 1) ([#521](https://github.com/Auxx-Ai/auxx-ai/issues/521)) ([82f852a](https://github.com/Auxx-Ai/auxx-ai/commit/82f852a1833f263cb24b60983b01e4fa9d2d05de))
* **kb:** table block with row/column reorder + GFM markdown roundtrip ([#546](https://github.com/Auxx-Ai/auxx-ai/issues/546)) ([61347a2](https://github.com/Auxx-Ai/auxx-ai/commit/61347a23604db1933d01e810482f8be2eefa1ea5))
* **kb:** table frame + restyled row/column delete buttons ([#548](https://github.com/Auxx-Ai/auxx-ai/issues/548)) ([2a2bda1](https://github.com/Auxx-Ai/auxx-ai/commit/2a2bda17817474451a94ca60ef96461c506ed11c))
* **kb:** table of contents, article pager, mobile sidebar, search dialog + layout refactor ([#519](https://github.com/Auxx-Ai/auxx-ai/issues/519)) ([1037e8c](https://github.com/Auxx-Ai/auxx-ai/commit/1037e8c07e486a410e79c98fd7c69d4a31f6d0eb))
* **kb:** tabs + accordion container blocks with markdown roundtrip ([#545](https://github.com/Auxx-Ai/auxx-ai/issues/545)) ([18a5619](https://github.com/Auxx-Ai/auxx-ai/commit/18a5619cf58d2e0195783fe2f4f2e7e778a730a4))
* **kopilot:** distributed page context + implicit-termination agent loop ([#537](https://github.com/Auxx-Ai/auxx-ai/issues/537)) ([e0801a0](https://github.com/Auxx-Ai/auxx-ai/commit/e0801a0e5a180352296cf4341391714a78b87f70))
* **kopilot:** inline reference picker with tabs + article denormalized fields ([#575](https://github.com/Auxx-Ai/auxx-ai/issues/575)) ([b96ce4c](https://github.com/Auxx-Ai/auxx-ai/commit/b96ce4c84ae0be2b3c6973183e9d3adfc4d2a0bc))
* **kopilot:** list_drafts tool + auxx:draft-list block ([#539](https://github.com/Auxx-Ai/auxx-ai/issues/539)) ([b3e1b97](https://github.com/Auxx-Ai/auxx-ai/commit/b3e1b978f8c98d012454d5526ad612641531ea8f))
* **kopilot:** page shell + tool-input validation + agent-fw cleanup ([#534](https://github.com/Auxx-Ai/auxx-ai/issues/534)) ([2164389](https://github.com/Auxx-Ai/auxx-ai/commit/21643891a9d54609f97f2b1811eb9a9e02d9f312))
* **kopilot:** page suggestions + list_tags + relative-date filters ([#543](https://github.com/Auxx-Ai/auxx-ai/issues/543)) ([0194b76](https://github.com/Auxx-Ai/auxx-ai/commit/0194b767b1a4d4ef6377b38d5a0dd32392813160))
* **kopilot:** plan_create/plan_update_step + transformToolResult hook ([#564](https://github.com/Auxx-Ai/auxx-ai/issues/564)) ([8ef9152](https://github.com/Auxx-Ai/auxx-ai/commit/8ef9152bc4154a77769a18224d992c29b9ae1dc7))
* **kopilot:** shift+n new-session hotkey + extract createEmptyTurnSnapshots ([#540](https://github.com/Auxx-Ai/auxx-ai/issues/540)) ([5c60353](https://github.com/Auxx-Ai/auxx-ai/commit/5c6035365d68bf38a03d2b9aa589c4732524d59b))
* **kopilot:** tool digests + inline auxx:// link snapshots ([#532](https://github.com/Auxx-Ai/auxx-ai/issues/532)) ([b360760](https://github.com/Auxx-Ai/auxx-ai/commit/b360760cfab1a1971a92fe20e593d44af7d247ae))
* **kopilot:** unified SessionRef context + consolidated article tools ([#576](https://github.com/Auxx-Ai/auxx-ai/issues/576)) ([e00713f](https://github.com/Auxx-Ai/auxx-ai/commit/e00713f1fb1938cf156f6d78a84651ef40ed6864))
* **kopilot:** unify reply tools across email + messaging channels ([#531](https://github.com/Auxx-Ai/auxx-ai/issues/531)) ([99ca2fc](https://github.com/Auxx-Ai/auxx-ai/commit/99ca2fc48ed4c035913c4bbf93e7451dc7292651))
* **mail:** per-inbox realtime sync for thread/message/participant events ([#562](https://github.com/Auxx-Ai/auxx-ai/issues/562)) ([1359a53](https://github.com/Auxx-Ai/auxx-ai/commit/1359a530abdd5439a0de658ccfbc254071c5a6cc))
* **mail:** processing indicator on threads/drafts with running workflows ([#560](https://github.com/Auxx-Ai/auxx-ai/issues/560)) ([4133c92](https://github.com/Auxx-Ai/auxx-ai/commit/4133c924aef327dcb8beabc4ecbe1ba2546b8ab0))
* **search:** per-model embeddings, weight renormalization, partial-failure signals ([#571](https://github.com/Auxx-Ai/auxx-ai/issues/571)) ([329d13d](https://github.com/Auxx-Ai/auxx-ai/commit/329d13dd8fb714a9828eaa2179ed5a59ed6737b6))
* **ui:** form-safe Button default, dialog Enter handling, CSS TextShimmer ([#559](https://github.com/Auxx-Ai/auxx-ai/issues/559)) ([29eaa0f](https://github.com/Auxx-Ai/auxx-ai/commit/29eaa0fcbc963739efa8effced49eac2005bcb3e))
* **web:** dataset card redesign + sidebar action prop + designs page tiles ([#565](https://github.com/Auxx-Ai/auxx-ai/issues/565)) ([c19e1f1](https://github.com/Auxx-Ai/auxx-ai/commit/c19e1f162282745c7528a9b95fcfdabe40a583cc))


### Bug Fixes

* **kb:** persist editor sidebar across article navigation ([#524](https://github.com/Auxx-Ai/auxx-ai/issues/524)) ([45a313b](https://github.com/Auxx-Ai/auxx-ai/commit/45a313b99aea41e55bddef3379eec0070d38bfcf))
* **mail:** mail-view dialog deletion redirect, fresh-create defaults, nested-layer guard ([#561](https://github.com/Auxx-Ai/auxx-ai/issues/561)) ([c3c6f3b](https://github.com/Auxx-Ai/auxx-ai/commit/c3c6f3b6a2a1e130c5c88beedfe1bfab4b4787bf))
* **redis:** recover dead singleton clients, isolate SSE subscribers ([#558](https://github.com/Auxx-Ai/auxx-ai/issues/558)) ([c446250](https://github.com/Auxx-Ai/auxx-ai/commit/c44625002c9a1187527a7c2b012ee7ad838487a3))

## [0.1.143](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.142...auxx-v0.1.143) (2026-04-29)


### Features

* **ai:** speech-to-text voice input for email composer ([#506](https://github.com/Auxx-Ai/auxx-ai/issues/506)) ([6d0a638](https://github.com/Auxx-Ai/auxx-ai/commit/6d0a63805ec2718ea5ebff35c48e0f5e479e8427))
* **custom-fields:** flatten currency options + smart-breadcrumb width fix ([#512](https://github.com/Auxx-Ai/auxx-ai/issues/512)) ([245b276](https://github.com/Auxx-Ai/auxx-ai/commit/245b276cb478c1000697dedb332478708af89255))
* **custom-fields:** server-side CALC resolver + AI prompt path refs ([#511](https://github.com/Auxx-Ai/auxx-ai/issues/511)) ([e925809](https://github.com/Auxx-Ai/auxx-ai/commit/e92580960aabe556a5d24412cba828f0b11f2e9d))
* **kb:** public site at /&lt;orgSlug&gt;/&lt;kbSlug&gt;/ + shared @auxx/ui/kb ([#517](https://github.com/Auxx-Ai/auxx-ai/issues/517)) ([da82289](https://github.com/Auxx-Ai/auxx-ai/commit/da82289f2aad6b1d3481920151cba6261a5471d7))
* **kopilot:** entity history/transcript tools + contact jobTitle ([#510](https://github.com/Auxx-Ai/auxx-ai/issues/510)) ([5c951dd](https://github.com/Auxx-Ai/auxx-ai/commit/5c951dd3e7cde359b457aefbd70cd5c801a88944))
* **kopilot:** list_notes + create_note tools; simplify comment access checks ([#514](https://github.com/Auxx-Ai/auxx-ai/issues/514)) ([cf790a4](https://github.com/Auxx-Ai/auxx-ai/commit/cf790a483215bef5538166f05d9aa4e055e00349))
* **records:** record hover card preview on badges ([#508](https://github.com/Auxx-Ai/auxx-ai/issues/508)) ([b0f29b6](https://github.com/Auxx-Ai/auxx-ai/commit/b0f29b6e5561836bfc45528cb172658d312dc342))
* **threads:** phase 1 — multi-entity links, activity, deadline scanner ([#509](https://github.com/Auxx-Ai/auxx-ai/issues/509)) ([ec2fccd](https://github.com/Auxx-Ai/auxx-ai/commit/ec2fccdcac49aaea012298416806946957aed947))
* **today:** ai suggestion bundles + capture-mode kopilot + approvals ([#513](https://github.com/Auxx-Ai/auxx-ai/issues/513)) ([2c7400d](https://github.com/Auxx-Ai/auxx-ai/commit/2c7400d547913ec7fb5bd88e1acd0ee7a3128e83))


### Bug Fixes

* **kb:** make apps/kb build under Next 16 cacheComponents ([#518](https://github.com/Auxx-Ai/auxx-ai/issues/518)) ([a10bb68](https://github.com/Auxx-Ai/auxx-ai/commit/a10bb686dfed6bad82c72e43433324b2482e18c1))

## [0.1.142](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.141...auxx-v0.1.142) (2026-04-28)


### Features

* **datasets:** sync document drawer state to URL ?id= param ([#495](https://github.com/Auxx-Ai/auxx-ai/issues/495)) ([16dd975](https://github.com/Auxx-Ai/auxx-ai/commit/16dd97531bc99a440d6c31e7f0ef0c7c8f795efe))
* **db:** use C collation for fractional sort columns ([#497](https://github.com/Auxx-Ai/auxx-ai/issues/497)) ([bf84eb1](https://github.com/Auxx-Ai/auxx-ai/commit/bf84eb11c1c00350fcde884f71b4c7e2909ce406))
* **extension:** allow multiple extension IDs (Web Store + local unpacked) ([#499](https://github.com/Auxx-Ai/auxx-ai/issues/499)) ([52be1fe](https://github.com/Auxx-Ai/auxx-ai/commit/52be1fe182eb73c57773299cf9d4f7d4f7e87e64))
* **favorites:** sidebar favorites with folders, drag-and-drop, inline rename ([#496](https://github.com/Auxx-Ai/auxx-ai/issues/496)) ([d6e4b4e](https://github.com/Auxx-Ai/auxx-ai/commit/d6e4b4ef78abd22ba5b58a56d1bd6fdf8b8a2d7d))
* **files:** sync folder + drawer state to URL params ([#501](https://github.com/Auxx-Ai/auxx-ai/issues/501)) ([87abd46](https://github.com/Auxx-Ai/auxx-ai/commit/87abd46289db8b9e43c57fb622369022695d4d4a))
* kopilot LLM-rendered blocks + mail Ignore-from + chat scroll pin ([#504](https://github.com/Auxx-Ai/auxx-ai/issues/504)) ([ed5fabd](https://github.com/Auxx-Ai/auxx-ai/commit/ed5fabdce6dca2d289c9e197437c625cfc19e93b))
* **kopilot:** dedupe check before create_entity + approval model fix ([#502](https://github.com/Auxx-Ai/auxx-ai/issues/502)) ([5a8754f](https://github.com/Auxx-Ai/auxx-ai/commit/5a8754f9507a54fbde35d8b5d4720eb1352ea3c8))
* **mail:** enable thread action shortcuts in split view ([#494](https://github.com/Auxx-Ai/auxx-ai/issues/494)) ([28e9409](https://github.com/Auxx-Ai/auxx-ai/commit/28e9409011c26ed0d6cbc849ae6fedac24680270))
* **sidebar:** unify Mail group with animated collapse sections ([#493](https://github.com/Auxx-Ai/auxx-ai/issues/493)) ([1421887](https://github.com/Auxx-Ai/auxx-ai/commit/1421887918a0910869c063737816f890562cfdb9))
* timeline canonical recordIds + actor names + FieldType snapshots ([#490](https://github.com/Auxx-Ai/auxx-ai/issues/490)) ([7cfb2de](https://github.com/Auxx-Ai/auxx-ai/commit/7cfb2defbc7e6a5176a01c42373162fd18ac8929))


### Bug Fixes

* **auth:** unify OAuth refresh-error handling and surface Workspace RAPT ([#498](https://github.com/Auxx-Ai/auxx-ai/issues/498)) ([2ee4156](https://github.com/Auxx-Ai/auxx-ai/commit/2ee415678882326214f40ab1fa7530ab35475183))
* **kopilot:** never persist half-pair assistant tool_calls ([#505](https://github.com/Auxx-Ai/auxx-ai/issues/505)) ([7802535](https://github.com/Auxx-Ai/auxx-ai/commit/78025352a5d5fb49c2b7b27e7e7c0191f7c06c6a))
* **posthog:** strip Cloudflare proxy headers before forwarding ([#492](https://github.com/Auxx-Ai/auxx-ai/issues/492)) ([b5a8861](https://github.com/Auxx-Ai/auxx-ai/commit/b5a8861f282b0b30242943520c7369630e46528a))

## [0.1.141](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.140...auxx-v0.1.141) (2026-04-26)


### Bug Fixes

* **privacy:** correct AI auto-send disclosure ([f13c33c](https://github.com/Auxx-Ai/auxx-ai/commit/f13c33c2a5d90d6cb6b7097990509519291c3741))

## [0.1.140](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.139...auxx-v0.1.140) (2026-04-26)


### Features

* enhance multi-value field handling and normalization ([#480](https://github.com/Auxx-Ai/auxx-ai/issues/480)) ([3270a3a](https://github.com/Auxx-Ai/auxx-ai/commit/3270a3a132eaf33f43f43dd31d1e80e3d5432e2a))
* extension record embed (iframe-based field editor) ([#485](https://github.com/Auxx-Ai/auxx-ai/issues/485)) ([b36450d](https://github.com/Auxx-Ai/auxx-ai/commit/b36450d290e224b871de243f59f717ac6eab5c69))
* field-change post-hooks + ticket/entity field-updated events ([#484](https://github.com/Auxx-Ai/auxx-ai/issues/484)) ([b4a89f4](https://github.com/Auxx-Ai/auxx-ai/commit/b4a89f4c337a0bc36e38b91d2cc87b84210f4e44))
* field-hooks framework (pre-write field hooks + pre-delete entity hooks) ([#482](https://github.com/Auxx-Ai/auxx-ai/issues/482)) ([009bbc9](https://github.com/Auxx-Ai/auxx-ai/commit/009bbc99412358d68fbe7f910d1bb4c2554b5452))
* **migrations:** add externalId field to contact and company entities ([#478](https://github.com/Auxx-Ai/auxx-ai/issues/478)) ([a06a9c3](https://github.com/Auxx-Ai/auxx-ai/commit/a06a9c3f71f666d5ea7f3ea7b8a1775100376825))
* system tag read-only guards + BOM descendant explosion fix ([#483](https://github.com/Auxx-Ai/auxx-ai/issues/483)) ([5b722d8](https://github.com/Auxx-Ai/auxx-ai/commit/5b722d80990ad25516fcf6e3f9c6e6709152ae02))
* timeline field-change snapshots + extension root-route refactor ([#486](https://github.com/Auxx-Ai/auxx-ai/issues/486)) ([92dee7d](https://github.com/Auxx-Ai/auxx-ai/commit/92dee7dd73b129bda9fd064364d0aa4456c21854))

## [0.1.139](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.138...auxx-v0.1.139) (2026-04-23)


### Features

* AI credit pool + sparkle overlay rework + table polish ([#476](https://github.com/Auxx-Ai/auxx-ai/issues/476)) ([bb32a4d](https://github.com/Auxx-Ai/auxx-ai/commit/bb32a4dd84b69a9a5216c87d68ba44e02903767e))

## [0.1.138](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.137...auxx-v0.1.138) (2026-04-23)


### Features

* add AI bulk generation functionality and enhance UI components with AI options ([#472](https://github.com/Auxx-Ai/auxx-ai/issues/472)) ([205584e](https://github.com/Auxx-Ai/auxx-ai/commit/205584e403c2e6abc351815cfa276fb6f932e611))
* add marching-ants copy highlight overlay and improve selection behavior ([#475](https://github.com/Auxx-Ai/auxx-ai/issues/475)) ([73776fc](https://github.com/Auxx-Ai/auxx-ai/commit/73776fc8c53e2215ae28dce58b7404412e257164))
* **command-palette:** dynamic entity create actions + hotkey fixes ([#467](https://github.com/Auxx-Ai/auxx-ai/issues/467)) ([8cccb80](https://github.com/Auxx-Ai/auxx-ai/commit/8cccb8014ca3e288ab5aeefa82c58b2395bd7346))
* enhance cell interaction and navigation with context integration and improved event handling ([#474](https://github.com/Auxx-Ai/auxx-ai/issues/474)) ([d7575a8](https://github.com/Auxx-Ai/auxx-ai/commit/d7575a87fa64f4885e064041bb2d5c3abb4e77ad))
* enhance cell selection overlay behavior and styling ([#471](https://github.com/Auxx-Ai/auxx-ai/issues/471)) ([59ddef3](https://github.com/Auxx-Ai/auxx-ai/commit/59ddef32e58da7f859fefbae7ce27d6d3cbc9954))
* enhance seeding scenarios and introduce AI options validation ([#470](https://github.com/Auxx-Ai/auxx-ai/issues/470)) ([478fd62](https://github.com/Auxx-Ai/auxx-ai/commit/478fd62ac2c1a4a0d8478113bd8109a3cbcb9259))
* implement hotkey support for entity creation and enhance UI with keyboard hints ([#469](https://github.com/Auxx-Ai/auxx-ai/issues/469)) ([8c7cb45](https://github.com/Auxx-Ai/auxx-ai/commit/8c7cb45a19d2421f889faf0338e80f294655d8d1))

## [0.1.137](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.136...auxx-v0.1.137) (2026-04-22)


### Features

* add demo route with redirect to demo URL ([7d7f547](https://github.com/Auxx-Ai/auxx-ai/commit/7d7f5475c18eab8ed95d128255000d910655b5fd))

## [0.1.136](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.135...auxx-v0.1.136) (2026-04-22)


### Features

* add Open Graph image generation script and update package.json ([#458](https://github.com/Auxx-Ai/auxx-ai/issues/458)) ([f17b382](https://github.com/Auxx-Ai/auxx-ai/commit/f17b3829f4ec398fbf341ab7350df72f515f7994))
* **dynamic-table:** enhance cell selection and coercion logic ([#465](https://github.com/Auxx-Ai/auxx-ai/issues/465)) ([109a330](https://github.com/Auxx-Ai/auxx-ai/commit/109a330b40cd2ed15719cfb508de989471ae1b2a))
* enhance contact conversations tab with thread details and improved message handling ([#464](https://github.com/Auxx-Ai/auxx-ai/issues/464)) ([e4abb2d](https://github.com/Auxx-Ai/auxx-ai/commit/e4abb2d26c73e6196d54cfa577a50a1811b3d21c))
* enhance email editor and record picker functionality ([#462](https://github.com/Auxx-Ai/auxx-ai/issues/462)) ([f9f3b3e](https://github.com/Auxx-Ai/auxx-ai/commit/f9f3b3ed169bcac4a5b9b9bab9320014323aa4f6))
* enhance entity update tool and validation mechanisms ([#461](https://github.com/Auxx-Ai/auxx-ai/issues/461)) ([c566b54](https://github.com/Auxx-Ai/auxx-ai/commit/c566b54d6f43cc59c76227ea92cb67c953202e61))
* remove unused RecordId import and update RecipientState interface in email editor ([#463](https://github.com/Auxx-Ai/auxx-ai/issues/463)) ([f3cb38c](https://github.com/Auxx-Ai/auxx-ai/commit/f3cb38c41610d55cf9abaf0ead62865c04f7ce2e))

## [0.1.135](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.134...auxx-v0.1.135) (2026-04-20)


### Features

* add GitHub star button component and integrate it into the mesh gradient generator page ([#456](https://github.com/Auxx-Ai/auxx-ai/issues/456)) ([c359e45](https://github.com/Auxx-Ai/auxx-ai/commit/c359e4542c8f8af1bd69bfdb4ca7cb5f6b458411))

## [0.1.134](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.133...auxx-v0.1.134) (2026-04-20)


### Features

* add mesh gradient generator to sitemap ([#454](https://github.com/Auxx-Ai/auxx-ai/issues/454)) ([86499fe](https://github.com/Auxx-Ai/auxx-ai/commit/86499fe3417da170ea0ebd947cbaa23fa0cac383))

## [0.1.133](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.132...auxx-v0.1.133) (2026-04-20)


### Bug Fixes

* adjust layout and styling for blog post and blog layout components ([#452](https://github.com/Auxx-Ai/auxx-ai/issues/452)) ([d422f8b](https://github.com/Auxx-Ai/auxx-ai/commit/d422f8bfa91a01428753d8030da883bb51d79dd0))

## [0.1.132](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.131...auxx-v0.1.132) (2026-04-20)


### Bug Fixes

* update Icon component color to white in integration sections ([#450](https://github.com/Auxx-Ai/auxx-ai/issues/450)) ([50c79cb](https://github.com/Auxx-Ai/auxx-ai/commit/50c79cb89392aadc46c4c8a9b42f32b34aca3aaf))

## [0.1.131](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.130...auxx-v0.1.131) (2026-04-20)


### Features

* add support for "Current user" placeholder in actor-field filters ([#447](https://github.com/Auxx-Ai/auxx-ai/issues/447)) ([a9b55ab](https://github.com/Auxx-Ai/auxx-ai/commit/a9b55ab4e8eb03c1315d0a617e22e6899af1f5a5))
* implement RandomGradient component and integrate gradient palettes ([#449](https://github.com/Auxx-Ai/auxx-ai/issues/449)) ([f3ae69b](https://github.com/Auxx-Ai/auxx-ai/commit/f3ae69b56060d97393fa5c2a23b2e3a61197051a))

## [0.1.130](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.129...auxx-v0.1.130) (2026-04-18)


### Features

* **participant:** add isInternal flag to classify participants from own domains ([#445](https://github.com/Auxx-Ai/auxx-ai/issues/445)) ([db10752](https://github.com/Auxx-Ai/auxx-ai/commit/db1075248deeac666360757e1449ed8d08b5fce1))

## [0.1.129](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.128...auxx-v0.1.129) (2026-04-18)


### Features

* add AnnouncementBadge component and integrate into HeroSection ([#441](https://github.com/Auxx-Ai/auxx-ai/issues/441)) ([075fa8b](https://github.com/Auxx-Ai/auxx-ai/commit/075fa8b77c8ae839b0bae23045feb074065d7ab7))
* add NestedThreadProvider and normalize record ID ([#443](https://github.com/Auxx-Ai/auxx-ai/issues/443)) ([7f6d93d](https://github.com/Auxx-Ai/auxx-ai/commit/7f6d93d8efcad0e202f1f2b0b942bf24d00327a2))
* enhance avatar upload functionality with optimistic updates and improved error handling ([#437](https://github.com/Auxx-Ai/auxx-ai/issues/437)) ([2f65242](https://github.com/Auxx-Ai/auxx-ai/commit/2f65242608a4b0d6d991d43e5569ebc5b9e403fe))
* enhance mail component responsiveness and improve thread display logic ([#440](https://github.com/Auxx-Ai/auxx-ai/issues/440)) ([6ecd116](https://github.com/Auxx-Ai/auxx-ai/commit/6ecd116df428a459df6352fc0ba809284c33b969))
* enhance record picker with secondary info display option ([#444](https://github.com/Auxx-Ai/auxx-ai/issues/444)) ([14d4083](https://github.com/Auxx-Ai/auxx-ai/commit/14d4083aea605f0e6fe4f505662c342622b0cba3))
* enhance thread selection and tagging functionality ([#439](https://github.com/Auxx-Ai/auxx-ai/issues/439)) ([90842b6](https://github.com/Auxx-Ai/auxx-ai/commit/90842b6a12c6ab6fe1ac26960975ff444e61511f))
* implement ticket linking and creation functionality in thread management ([#442](https://github.com/Auxx-Ai/auxx-ai/issues/442)) ([c109544](https://github.com/Auxx-Ai/auxx-ai/commit/c109544cf640bb6fc1fa9552b0d7450093850115))

## [0.1.128](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.127...auxx-v0.1.128) (2026-04-17)


### Features

* add company enrichment fields and related event handling ([#435](https://github.com/Auxx-Ai/auxx-ai/issues/435)) ([ba4e9e7](https://github.com/Auxx-Ai/auxx-ai/commit/ba4e9e7fd17225681209e5ba3af86e3eaa99a003))

## [0.1.127](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.126...auxx-v0.1.127) (2026-04-17)


### Features

* **database:** add FreeToolLead schema and journal entry ([#433](https://github.com/Auxx-Ai/auxx-ai/issues/433)) ([8a8c5c9](https://github.com/Auxx-Ai/auxx-ai/commit/8a8c5c951c9901e2b3270e7e5eecd5af718a088e))

## [0.1.126](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.125...auxx-v0.1.126) (2026-04-17)


### Features

* add company domain handling and avatar fields ([#428](https://github.com/Auxx-Ai/auxx-ai/issues/428)) ([d33dcfb](https://github.com/Auxx-Ai/auxx-ai/commit/d33dcfb856dbcf8252407d8241ce3175a5f3795f))
* add comprehensive guides on CRM for small businesses and CRM tools for 2026 ([#431](https://github.com/Auxx-Ai/auxx-ai/issues/431)) ([a5fa0f6](https://github.com/Auxx-Ai/auxx-ai/commit/a5fa0f6e57074bd0cc30ab16413f1a55942c8355))
* **ingest:** implement message storage and reconciliation pipeline ([#430](https://github.com/Auxx-Ai/auxx-ai/issues/430)) ([acbd89e](https://github.com/Auxx-Ai/auxx-ai/commit/acbd89e48a992cba52159aea945abd9f4b375770))
* remove outdated image and update CRM tools article content ([#432](https://github.com/Auxx-Ai/auxx-ai/issues/432)) ([9fc73ad](https://github.com/Auxx-Ai/auxx-ai/commit/9fc73ad9eb02f5ee345fa4031a5b0459b21c9fd8))

## [0.1.125](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.124...auxx-v0.1.125) (2026-04-17)


### Features

* add support for .body files in URL replacement process ([a2fb23a](https://github.com/Auxx-Ai/auxx-ai/commit/a2fb23adc2cdea32f4cd6bb82d2f4b1f57796ada))

## [0.1.124](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.123...auxx-v0.1.124) (2026-04-17)


### Features

* add company entity and related functionality ([#417](https://github.com/Auxx-Ai/auxx-ai/issues/417)) ([5834b63](https://github.com/Auxx-Ai/auxx-ai/commit/5834b63e76f372035bea5825da530e1db7cc5b26))
* add video asset generation for recordings ([#424](https://github.com/Auxx-Ai/auxx-ai/issues/424)) ([154983f](https://github.com/Auxx-Ai/auxx-ai/commit/154983ffc07b4a17cade0f3fee178a14c4f5b664))
* **database:** add recording domain schema and related tables ([#418](https://github.com/Auxx-Ai/auxx-ai/issues/418)) ([da312dc](https://github.com/Auxx-Ai/auxx-ai/commit/da312dcef8774ab87c103a5936ef88cb27071b05))
* db type fix ([#426](https://github.com/Auxx-Ai/auxx-ai/issues/426)) ([5c97f49](https://github.com/Auxx-Ai/auxx-ai/commit/5c97f4901ed4805b691faacb3fa3d89bc702dbbf))
* enhance actor system integration and rename existing system users to "Auxx.ai" ([#425](https://github.com/Auxx-Ai/auxx-ai/issues/425)) ([68a942b](https://github.com/Auxx-Ai/auxx-ai/commit/68a942ba4172a2ebd6f41e0c5e9681546ac301ea))
* enhance StatCards component with horizontal scrolling and no-scrollbar styling ([#415](https://github.com/Auxx-Ai/auxx-ai/issues/415)) ([f36b337](https://github.com/Auxx-Ai/auxx-ai/commit/f36b337436a27567d661723df4e8ebe994315257))
* implement AI post-processing for call recordings ([#423](https://github.com/Auxx-Ai/auxx-ai/issues/423)) ([37ada59](https://github.com/Auxx-Ai/auxx-ai/commit/37ada599437c1754f3f2adb68d8e583215f87954))
* **meeting:** introduce meeting entity with fields and relationships ([#419](https://github.com/Auxx-Ai/auxx-ai/issues/419)) ([e424999](https://github.com/Auxx-Ai/auxx-ai/commit/e424999f015e94fcc2748ec36b5f6a68f8798fff))
* new video player for recordings was created ([#422](https://github.com/Auxx-Ai/auxx-ai/issues/422)) ([8586f80](https://github.com/Auxx-Ai/auxx-ai/commit/8586f80cd0aa2f53ea24ddb63f35a797c8a0bd4c))
* **recording:** implement media downloading and scheduling for recordings ([#420](https://github.com/Auxx-Ai/auxx-ai/issues/420)) ([e798150](https://github.com/Auxx-Ai/auxx-ai/commit/e798150d6b6575e8f5394e956b683df1f2636a46))
* **recording:** implement recording service with scheduling, retrieval ([#421](https://github.com/Auxx-Ai/auxx-ai/issues/421)) ([908fc45](https://github.com/Auxx-Ai/auxx-ai/commit/908fc4579fcbb3bf82643fe1382b7cf8f7014c04))
* remove obsolete image assets from the repository ([1b9f061](https://github.com/Auxx-Ai/auxx-ai/commit/1b9f061a4caaf520534cf47b00f20c9524f64058))

## [0.1.123](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.122...auxx-v0.1.123) (2026-04-14)


### Features

* add multi-provider AI system blog post and related images ([#413](https://github.com/Auxx-Ai/auxx-ai/issues/413)) ([4078217](https://github.com/Auxx-Ai/auxx-ai/commit/4078217c9b8bf64c02786a8f0161d961f9b82452))
* add TouchSensor support for drag-and-drop functionality across various components ([#411](https://github.com/Auxx-Ai/auxx-ai/issues/411)) ([7ec38cb](https://github.com/Auxx-Ai/auxx-ai/commit/7ec38cbf325073f23891fd7a7ccc2f9600222108))

## [0.1.122](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.121...auxx-v0.1.122) (2026-04-13)


### Features

* update mobile tooltip behavior to allow click propagation on touch devices ([98a07f3](https://github.com/Auxx-Ai/auxx-ai/commit/98a07f304ca338bc4be69757a41caaa335690b83))

## [0.1.121](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.120...auxx-v0.1.121) (2026-04-13)


### Features

* add @types/mdx dependency for improved TypeScript support ([#408](https://github.com/Auxx-Ai/auxx-ai/issues/408)) ([e12c3ac](https://github.com/Auxx-Ai/auxx-ai/commit/e12c3ac0fae892a0e2f5fe794b77d14cbeb8f99a))

## [0.1.120](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.119...auxx-v0.1.120) (2026-04-13)


### Features

* add multiple blog post images for enhanced content presentation ([#404](https://github.com/Auxx-Ai/auxx-ai/issues/404)) ([9c0e228](https://github.com/Auxx-Ai/auxx-ai/commit/9c0e22874dc9cac97ae59d9deef5fdd7f05a1cbb))
* enhance notification center with mobile support and improve feature limit parsing ([#406](https://github.com/Auxx-Ai/auxx-ai/issues/406)) ([e17a659](https://github.com/Auxx-Ai/auxx-ai/commit/e17a659abf0856a063d99085d3126b30a4f269a0))
* improve mobile layout for mailbox and thread components ([#407](https://github.com/Auxx-Ai/auxx-ai/issues/407)) ([2b1cbda](https://github.com/Auxx-Ai/auxx-ai/commit/2b1cbdae2b5a9e0a7bb00a84e15f7963adade102))

## [0.1.119](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.118...auxx-v0.1.119) (2026-04-11)


### Features

* add avatar field support across entity templates and UI components ([#401](https://github.com/Auxx-Ai/auxx-ai/issues/401)) ([ef1aa5a](https://github.com/Auxx-Ai/auxx-ai/commit/ef1aa5a7d1508c80af6bcd7acde5969618864972))
* enhance Kopilot capabilities with detailed descriptions and logging ([#399](https://github.com/Auxx-Ai/auxx-ai/issues/399)) ([e8fb09d](https://github.com/Auxx-Ai/auxx-ai/commit/e8fb09d65c585a002b9dce93619c68a0bf0cf3d7))
* enhance responsive design across various components ([#402](https://github.com/Auxx-Ai/auxx-ai/issues/402)) ([40e6679](https://github.com/Auxx-Ai/auxx-ai/commit/40e6679b0b889f647c5c9c97afd4286569c461ef))

## [0.1.118](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.117...auxx-v0.1.118) (2026-04-10)


### Features

* add BOM-aware stock movement functionality ([#398](https://github.com/Auxx-Ai/auxx-ai/issues/398)) ([05ef5b3](https://github.com/Auxx-Ai/auxx-ai/commit/05ef5b37655eca21d44925d24e0e92d6aa6f4d52))
* enhance field value handling with cached field support and new utility functions ([#396](https://github.com/Auxx-Ai/auxx-ai/issues/396)) ([20fa88f](https://github.com/Auxx-Ai/auxx-ai/commit/20fa88f0e53c3b780000e5a0f2a2b208992f0304))

## [0.1.117](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.116...auxx-v0.1.117) (2026-04-10)


### Features

* remove part inventory tab component from detail view tab registry ([799625d](https://github.com/Auxx-Ai/auxx-ai/commit/799625d9e5ec76065c8cb769a84932d36ccbb2fc))

## [0.1.116](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.115...auxx-v0.1.116) (2026-04-10)


### Features

* add realtime sync feature flag support across various components ([#389](https://github.com/Auxx-Ai/auxx-ai/issues/389)) ([832d7b3](https://github.com/Auxx-Ai/auxx-ai/commit/832d7b3b6cfc99da51158c653bf4e1c5c395d032))
* add stock movement and vendor part event handling with triggers and types ([#393](https://github.com/Auxx-Ai/auxx-ai/issues/393)) ([a811ad0](https://github.com/Auxx-Ai/auxx-ai/commit/a811ad056365d4250b309509e74a45fce096b9ae))
* add stock movement entity and related fields ([#392](https://github.com/Auxx-Ai/auxx-ai/issues/392)) ([e055826](https://github.com/Auxx-Ai/auxx-ai/commit/e055826133f03a6c58cd2338b2c7bdcee85548b2))
* add vendor part cost fields and update BOM calculations for landed cost ([#390](https://github.com/Auxx-Ai/auxx-ai/issues/390)) ([95f69a0](https://github.com/Auxx-Ai/auxx-ai/commit/95f69a093df205977f086520d3e0f04b49848042))
* enhance parts page functionality and improve vendor part triggers with new field handling ([#386](https://github.com/Auxx-Ai/auxx-ai/issues/386)) ([09921e3](https://github.com/Auxx-Ai/auxx-ai/commit/09921e374fead6fb857ce378585cb4d63130394a))
* enhance realtime capabilities with Pusher integration ([#388](https://github.com/Auxx-Ai/auxx-ai/issues/388)) ([8b67edd](https://github.com/Auxx-Ai/auxx-ai/commit/8b67eddfd40bf6c5782713147c732d0fab51c9ed))
* implement tab reordering functionality with drag-and-drop support ([#391](https://github.com/Auxx-Ai/auxx-ai/issues/391)) ([c6ffe4f](https://github.com/Auxx-Ai/auxx-ai/commit/c6ffe4f0df266f262ba7fc31b38c4b7c298d4dff))

## [0.1.115](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.114...auxx-v0.1.115) (2026-04-09)


### Features

* column visibility handling in dynamic table components ([#385](https://github.com/Auxx-Ai/auxx-ai/issues/385)) ([5318c7a](https://github.com/Auxx-Ai/auxx-ai/commit/5318c7a16af40e0504d7ecb63379b277e083931b))
* enhance file handling with FileRef type and related utilities ([#381](https://github.com/Auxx-Ai/auxx-ai/issues/381)) ([3742366](https://github.com/Auxx-Ai/auxx-ai/commit/374236680ca1a1a966f866b65516dcc7fc146453))
* implement field and entity triggers for vendor parts and subparts ([#384](https://github.com/Auxx-Ai/auxx-ai/issues/384)) ([43cd9b7](https://github.com/Auxx-Ai/auxx-ai/commit/43cd9b7764f0edc3b2850dafca61479ebe536d63))
* introduce SystemAttribute type and update related interfaces for type safety ([#383](https://github.com/Auxx-Ai/auxx-ai/issues/383)) ([4f8fd98](https://github.com/Auxx-Ai/auxx-ai/commit/4f8fd98ef92278d1628b938a3b425000e98fbe6f))

## [0.1.114](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.113...auxx-v0.1.114) (2026-04-08)


### Features

* add FilePicker component for file management in UI ([#380](https://github.com/Auxx-Ai/auxx-ai/issues/380)) ([6ff9727](https://github.com/Auxx-Ai/auxx-ai/commit/6ff9727246d0697be682170b1f8b0ec91127fa75))
* add Kimi and Qwen AI providers with respective clients and capabilities ([#374](https://github.com/Auxx-Ai/auxx-ai/issues/374)) ([cfe97ed](https://github.com/Auxx-Ai/auxx-ai/commit/cfe97ed3e761e6d947bf462f2b1f7aec97752ee6))
* add modelId to AiAgentSession and implement model switching utilities ([#377](https://github.com/Auxx-Ai/auxx-ai/issues/377)) ([4d2b249](https://github.com/Auxx-Ai/auxx-ai/commit/4d2b249e8235a878adb7cd303191d9c6dc1e3f7f))
* enhance AI provider management with system credentials and caching ([#375](https://github.com/Auxx-Ai/auxx-ai/issues/375)) ([61ba7b4](https://github.com/Auxx-Ai/auxx-ai/commit/61ba7b40ed1e1b43eb91f1dad51da09239632737))
* enhance Kimi and Qwen AI providers with new models, parameters ([#378](https://github.com/Auxx-Ai/auxx-ai/issues/378)) ([990a9ba](https://github.com/Auxx-Ai/auxx-ai/commit/990a9ba243cdf5cb70f9f8fd6b1d01b26b27fda9))
* enhance reasoning content handling across AI providers and improve context management ([#376](https://github.com/Auxx-Ai/auxx-ai/issues/376)) ([1f4f242](https://github.com/Auxx-Ai/auxx-ai/commit/1f4f2427c0abcff71e40d4a93621f135bc5bf1de))
* enhance UI components and improve functionality ([#372](https://github.com/Auxx-Ai/auxx-ai/issues/372)) ([47a52de](https://github.com/Auxx-Ai/auxx-ai/commit/47a52ded2d73c8dec61bd042045176ad8862f13e))
* implement AI steps animation and enhance UI components with shimmer effects ([#379](https://github.com/Auxx-Ai/auxx-ai/issues/379)) ([aa71065](https://github.com/Auxx-Ai/auxx-ai/commit/aa710653baf3d0b431078d52a2d4a62936de63c0))

## [0.1.113](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.112...auxx-v0.1.113) (2026-04-07)


### Features

* enhance MultiSelectPicker with edit and browse functionality ([#368](https://github.com/Auxx-Ai/auxx-ai/issues/368)) ([12189d4](https://github.com/Auxx-Ai/auxx-ai/commit/12189d48f7bcfbcd54103a5e73fa20335d1040fd))
* enhance OpenAI LLM client with model retirement checks and improved capabilities ([#370](https://github.com/Auxx-Ai/auxx-ai/issues/370)) ([b7fc91b](https://github.com/Auxx-Ai/auxx-ai/commit/b7fc91b8d5b8d3b811adb3ebf169a1dbf15d87ae))
* enhance provider configuration with unique type index and model overrides ([#371](https://github.com/Auxx-Ai/auxx-ai/issues/371)) ([5495a53](https://github.com/Auxx-Ai/auxx-ai/commit/5495a53061f1f058aae52fcf3150909b47b30fa5))

## [0.1.112](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.111...auxx-v0.1.112) (2026-04-04)


### Features

* add active thread version tracking and ticket row actions component ([#359](https://github.com/Auxx-Ai/auxx-ai/issues/359)) ([43adc2e](https://github.com/Auxx-Ai/auxx-ai/commit/43adc2e1f1c916a895ecccb276d6a4ad7fe478c7))
* add entity management tools and feedback system ([#363](https://github.com/Auxx-Ai/auxx-ai/issues/363)) ([ed50ddb](https://github.com/Auxx-Ai/auxx-ai/commit/ed50ddb57b72a711644e5fe80c4e3cefb04294a7))
* add prompt template functionality and related tools ([#366](https://github.com/Auxx-Ai/auxx-ai/issues/366)) ([921d7b0](https://github.com/Auxx-Ai/auxx-ai/commit/921d7b0b2ef6cb01467b19e9827662c5402e0289))
* add quick actions support and enhance resource registry ([#357](https://github.com/Auxx-Ai/auxx-ai/issues/357)) ([5efe4a6](https://github.com/Auxx-Ai/auxx-ai/commit/5efe4a6fae182e4553239f65c33b61bff32a8b1d))
* enhance relation input handling and add collapsible animations ([#360](https://github.com/Auxx-Ai/auxx-ai/issues/360)) ([0fbb501](https://github.com/Auxx-Ai/auxx-ai/commit/0fbb50145b1a6804104391196f218042923257fd))
* enhance status bar and tool status display ([#367](https://github.com/Auxx-Ai/auxx-ai/issues/367)) ([22bb016](https://github.com/Auxx-Ai/auxx-ai/commit/22bb0166c721ba0c5b63ab35613d9a28f3ee2612))
* enhance ThinkingSteps component with animations and improve tool execution persistence ([#364](https://github.com/Auxx-Ai/auxx-ai/issues/364)) ([0f1b17d](https://github.com/Auxx-Ai/auxx-ai/commit/0f1b17dd28cc4cefe96c5897225749519b1c1248))
* implement records search functionality with custom search bar ([#362](https://github.com/Auxx-Ai/auxx-ai/issues/362)) ([6c01522](https://github.com/Auxx-Ai/auxx-ai/commit/6c01522139c9225bd7e2f34b1c020a91d5b04429))
* integrate ScrollArea component into various tabs for improved scrolling experience ([#365](https://github.com/Auxx-Ai/auxx-ai/issues/365)) ([05b5f9d](https://github.com/Auxx-Ai/auxx-ai/commit/05b5f9dc84b39f3d7ce84a225f0e9d36566d2fb9))
* kopilot initial implementation ([02f3269](https://github.com/Auxx-Ai/auxx-ai/commit/02f32696ff04db5a8190605cf873d4f48dadb9ed))
* **searchbar:** implement search store and UI components ([#361](https://github.com/Auxx-Ai/auxx-ai/issues/361)) ([a333445](https://github.com/Auxx-Ai/auxx-ai/commit/a333445e90b0b912a91f97224c4f48b224112c5f))

## [0.1.111](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.110...auxx-v0.1.111) (2026-04-01)


### Features

* add IGNORED status to thread management and filtering ([#354](https://github.com/Auxx-Ai/auxx-ai/issues/354)) ([814865c](https://github.com/Auxx-Ai/auxx-ai/commit/814865c5144b58ba3611a654f14159caa511299e))
* implement tag picker functionality and enhance thread selection handling ([#356](https://github.com/Auxx-Ai/auxx-ai/issues/356)) ([b13411e](https://github.com/Auxx-Ai/auxx-ai/commit/b13411e44f4137873ee0b2f6ef31dd93b1e00491))

## [0.1.110](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.109...auxx-v0.1.110) (2026-03-31)


### Features

* enhance organization seeding and reset functionality with scenario options ([#352](https://github.com/Auxx-Ai/auxx-ai/issues/352)) ([b0a6325](https://github.com/Auxx-Ai/auxx-ai/commit/b0a63251e697938859447527232ebd3d7bff575e))

## [0.1.109](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.108...auxx-v0.1.109) (2026-03-29)


### Features

* add ACTOR field type and related functionality ([07d36a0](https://github.com/Auxx-Ai/auxx-ai/commit/07d36a08a2b077791d8eda90546df86e00e90b4d))
* add allowed senders management for forwarding integrations ([#228](https://github.com/Auxx-Ai/auxx-ai/issues/228)) ([3a209f1](https://github.com/Auxx-Ai/auxx-ai/commit/3a209f1517a7fefba2115a7f941f96501edab5dc))
* add API service implementation and environment variable loader ([#130](https://github.com/Auxx-Ai/auxx-ai/issues/130)) ([648e63e](https://github.com/Auxx-Ai/auxx-ai/commit/648e63eea42c0a4f15dc288caf06ca5d4577908b))
* add app icon upload component and presigned URL API for S3 uploads ([#151](https://github.com/Auxx-Ai/auxx-ai/issues/151)) ([cc428dd](https://github.com/Auxx-Ai/auxx-ai/commit/cc428dd968047b67b6b9d5cde3c8bcde05c9c726))
* add app trigger functionality to workflows ([#165](https://github.com/Auxx-Ai/auxx-ai/issues/165)) ([dc48fff](https://github.com/Auxx-Ai/auxx-ai/commit/dc48fffac8f1429026b2260211602fc9b64ec69c))
* add app trigger test events and section components ([#168](https://github.com/Auxx-Ai/auxx-ai/issues/168)) ([bb0adbc](https://github.com/Auxx-Ai/auxx-ai/commit/bb0adbc7302d959149dd10f5b153ff418db9f297))
* add array accessor handling and context menu updates for variable selection ([#345](https://github.com/Auxx-Ai/auxx-ai/issues/345)) ([aecdaee](https://github.com/Auxx-Ai/auxx-ai/commit/aecdaee6f67f11d4963516fc0e431ee77eb5b74b))
* add batch hydration for field values and enhance logging capabilities in workflow execution ([#325](https://github.com/Auxx-Ai/auxx-ai/issues/325)) ([cf00828](https://github.com/Auxx-Ai/auxx-ai/commit/cf0082878b450100ff95105dc68f52298957442d))
* add biome ignore comment for auto-generated files ([5d283b2](https://github.com/Auxx-Ai/auxx-ai/commit/5d283b2b9aca1834c3a01cb3577498f8dd899b6b))
* add build step for workspace packages and update package exports ([7dc2840](https://github.com/Auxx-Ai/auxx-ai/commit/7dc284005a4ea717d3a305ffde93d973b33e9d7d))
* add CALC field type and expression evaluation ([74538be](https://github.com/Auxx-Ai/auxx-ai/commit/74538be32e33e7aab0794846721b2a3b0535091c))
* add calc field type and related functionality ([7de06d9](https://github.com/Auxx-Ai/auxx-ai/commit/7de06d9ccae7e0aa9567462880c59bf706391ef1))
* add configurable capability to field types for better field management ([3f4b99f](https://github.com/Auxx-Ai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* add connection listing and access control for apps ([#222](https://github.com/Auxx-Ai/auxx-ai/issues/222)) ([dbd883e](https://github.com/Auxx-Ai/auxx-ai/commit/dbd883ea3c78efb7b5341ce0eaad9d11eef0afda))
* add create dialog support in field input adapter for relationship fields ([3f4b99f](https://github.com/Auxx-Ai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* add cross-app login token functionality with Ed25519 signing ([#123](https://github.com/Auxx-Ai/auxx-ai/issues/123)) ([4d1a603](https://github.com/Auxx-Ai/auxx-ai/commit/4d1a603b9cde8b303feabffe727b70feb6d77c9f))
* add date parsing functionality and update task service ([f0f6d21](https://github.com/Auxx-Ai/auxx-ai/commit/f0f6d21329372bcee92f1bf2cd4416b106644148))
* add demo organization features and cleanup jobs ([#301](https://github.com/Auxx-Ai/auxx-ai/issues/301)) ([4cf3929](https://github.com/Auxx-Ai/auxx-ai/commit/4cf3929fe11f241f013e6d8419547b6a80d13995))
* add dialogs for editing column formatting and labels in dynamic tables ([f10d354](https://github.com/Auxx-Ai/auxx-ai/commit/f10d3544bf16b8992e73eb2f4ddb0978ec02d97a))
* add Docker image workflow and enhance organization details page… ([#17](https://github.com/Auxx-Ai/auxx-ai/issues/17)) ([4c3724b](https://github.com/Auxx-Ai/auxx-ai/commit/4c3724b59add769548819738d78c7ba455fe4768))
* add Dockerfiles and health routes for homepage and docs ([#178](https://github.com/Auxx-Ai/auxx-ai/issues/178)) ([5120924](https://github.com/Auxx-Ai/auxx-ai/commit/512092486e1c80f08782e24b54f0b8391cd2c78e))
* add dynamic export to auth and public workflow layouts ([#190](https://github.com/Auxx-Ai/auxx-ai/issues/190)) ([b40dd8d](https://github.com/Auxx-Ai/auxx-ai/commit/b40dd8dbb6600bf582a662301c2d16497cc223a9))
* add dynamic trigger input registration and unregistration ([#174](https://github.com/Auxx-Ai/auxx-ai/issues/174)) ([e7a4dd3](https://github.com/Auxx-Ai/auxx-ai/commit/e7a4dd3c90a908f8562eb8dbbbd9a1d1975357e0))
* add entity templates ([64ec4c7](https://github.com/Auxx-Ai/auxx-ai/commit/64ec4c77f4891db62e0e152e95a10f9d8e767244))
* add EntityPreviewCard component for inline editing of entity fields ([#259](https://github.com/Auxx-Ai/auxx-ai/issues/259)) ([40962c2](https://github.com/Auxx-Ai/auxx-ai/commit/40962c2e671f523e7b7e182bf1541c7a4ba16036))
* add FieldDivider and FieldRow components for improved layout in… ([#161](https://github.com/Auxx-Ai/auxx-ai/issues/161)) ([f01dc9f](https://github.com/Auxx-Ai/auxx-ai/commit/f01dc9f84f42ed15b99b02e1ebb324da9277ab30))
* add FormatProcessor for various text and number formatting operations ([#347](https://github.com/Auxx-Ai/auxx-ai/issues/347)) ([4391859](https://github.com/Auxx-Ai/auxx-ai/commit/439185972bef6516e9c2428950a8ad9b47b9b4fe))
* add GitHub Action to validate PR titles ([d133d9b](https://github.com/Auxx-Ai/auxx-ai/commit/d133d9be3294514ee4cee60a69b01e8a76b6f5d4))
* add GroupMemberService for managing group memberships and user actors ([b0c45f6](https://github.com/Auxx-Ai/auxx-ai/commit/b0c45f6684b7f9d2ffec52312a75234c6bf09071))
* add icon support to workflow templates ([#292](https://github.com/Auxx-Ai/auxx-ai/issues/292)) ([5bfc876](https://github.com/Auxx-Ai/auxx-ai/commit/5bfc8764b6852967fcfa06fd7c7389ea75551dfe))
* add idap email integration ([#211](https://github.com/Auxx-Ai/auxx-ai/issues/211)) ([ed83ef6](https://github.com/Auxx-Ai/auxx-ai/commit/ed83ef6336b9cb3af80d99a3abe7b5eb994d490e))
* add installed apps and workflow apps providers to cache ([#275](https://github.com/Auxx-Ai/auxx-ai/issues/275)) ([f6a8573](https://github.com/Auxx-Ai/auxx-ai/commit/f6a8573dcdf01c330fe84765490cf7bf4d2a38be))
* add integration cache for organization provider lookups ([f094994](https://github.com/Auxx-Ai/auxx-ai/commit/f094994c83d4fe6e300002e1875a439034b6f6eb))
* add integration tests for billing plan changes and trials ([#288](https://github.com/Auxx-Ai/auxx-ai/issues/288)) ([28c3052](https://github.com/Auxx-Ai/auxx-ai/commit/28c30528a62d40004574a197f7ca05b87d93826d))
* add IntegrationTokenAccessor for managing encrypted integration… ([#31](https://github.com/Auxx-Ai/auxx-ai/issues/31)) ([da16326](https://github.com/Auxx-Ai/auxx-ai/commit/da16326b142412571ba027cdcefa97dc3335ca21))
* add inventory, subparts, and vendors tabs to part drawer configuration ([8d829b1](https://github.com/Auxx-Ai/auxx-ai/commit/8d829b1827d6824183ca89c72577e145b31063a1))
* add JSON field support with display and input components ([77ab32c](https://github.com/Auxx-Ai/auxx-ai/commit/77ab32cfb31211b1f52ad5b0ca84938f508e6c4a))
* add merge functionality with UI components ([96b564a](https://github.com/Auxx-Ai/auxx-ai/commit/96b564a1a5d18916473a679a9c2ad8f764ef4455))
* add migration stage for database dependencies in Dockerfile ([#112](https://github.com/Auxx-Ai/auxx-ai/issues/112)) ([475e218](https://github.com/Auxx-Ai/auxx-ai/commit/475e21859490ba672184af0efba77aee2f6e8e94))
* add NAME field support and link to source fields; enhance UI components with new task tab and styling updates ([e0c4315](https://github.com/Auxx-Ai/auxx-ai/commit/e0c4315e1051cfe2b97da7528574791df6c79a6f))
* add new entity templates for meetings, projects, quality inspections, quotes, referrals ([#260](https://github.com/Auxx-Ai/auxx-ai/issues/260)) ([7ee6e30](https://github.com/Auxx-Ai/auxx-ai/commit/7ee6e302122cae538eea2a4d041305fd77a1d3a3))
* add new signup videos and update onboarding pages with video backgrounds ([#332](https://github.com/Auxx-Ai/auxx-ai/issues/332)) ([a2d07a9](https://github.com/Auxx-Ai/auxx-ai/commit/a2d07a95da32988345ecded0218d95d0101a5a2a))
* add onClose prop to InlinePickerPopover and related components for improved picker management ([e00f0ea](https://github.com/Auxx-Ai/auxx-ai/commit/e00f0ea7d5796056c4b9a04235bca0217dccd46f))
* add one-click installation script and Docker Compose configuration ([#114](https://github.com/Auxx-Ai/auxx-ai/issues/114)) ([3a28bb1](https://github.com/Auxx-Ai/auxx-ai/commit/3a28bb178d2f4df7d21124878900f7fae32e0781))
* add optional name field to user profile update ([#255](https://github.com/Auxx-Ai/auxx-ai/issues/255)) ([4325331](https://github.com/Auxx-Ai/auxx-ai/commit/43253312cbb7165ef33dcb62dc54170a1352adb5))
* add overage detection and handling for feature limits ([#265](https://github.com/Auxx-Ai/auxx-ai/issues/265)) ([80fbd97](https://github.com/Auxx-Ai/auxx-ai/commit/80fbd974b372f4ce5e8556defcb6d877e970aca5))
* add platform detection and keyboard shortcuts for dialog submissions ([9b7e076](https://github.com/Auxx-Ai/auxx-ai/commit/9b7e0764a274a6ec1495296f25ed4fa257454058))
* add polling trigger functionality and related schema updates ([#172](https://github.com/Auxx-Ai/auxx-ai/issues/172)) ([4df0149](https://github.com/Auxx-Ai/auxx-ai/commit/4df0149604a84955397010ab3379228683d7cfe4))
* add public approval page with token-based and authenticated flows ([#338](https://github.com/Auxx-Ai/auxx-ai/issues/338)) ([3067e1d](https://github.com/Auxx-Ai/auxx-ai/commit/3067e1d19d1ef012f3a837ba34419998c01422f1))
* add record link editor and badge components ([c9b5fc3](https://github.com/Auxx-Ai/auxx-ai/commit/c9b5fc336198306ca442ef26a347ea8997f5eefd))
* add release-please configuration for automated versioning ([3312539](https://github.com/Auxx-Ai/auxx-ai/commit/33125390dd2f3d220f7ac010fa2e255034191aa1))
* add resolvers for system relationships and virtual fields ([#331](https://github.com/Auxx-Ai/auxx-ai/issues/331)) ([9efa52f](https://github.com/Auxx-Ai/auxx-ai/commit/9efa52ff96a5540f582f84fe65a43d696c73bee0))
* add scheduled message functionality ([#339](https://github.com/Auxx-Ai/auxx-ai/issues/339)) ([f18dfe7](https://github.com/Auxx-Ai/auxx-ai/commit/f18dfe7bcf514764ee3b60b9722c1cb5df33f7f9))
* add scheduled message functionality with enqueue and send jobs ([#336](https://github.com/Auxx-Ai/auxx-ai/issues/336)) ([7c5e58f](https://github.com/Auxx-Ai/auxx-ai/commit/7c5e58fc25631248a9a49f6d6a9dbdf568a860f4))
* add SDK_CLIENT_SECRET to Docker workflow and enhance user profi… ([#106](https://github.com/Auxx-Ai/auxx-ai/issues/106)) ([1530784](https://github.com/Auxx-Ai/auxx-ai/commit/1530784169c70f030e1690fa2c59b6b2345ce348))
* add SDK_CLIENT_SECRET to env config and update related services ([#100](https://github.com/Auxx-Ai/auxx-ai/issues/100)) ([83fe932](https://github.com/Auxx-Ai/auxx-ai/commit/83fe9323fa37c3d5c0916f4823a72c2e799e59d7))
* add shared test utilities and fixtures for integration tests ([#147](https://github.com/Auxx-Ai/auxx-ai/issues/147)) ([5f812f9](https://github.com/Auxx-Ai/auxx-ai/commit/5f812f9132f29e74613ebdf164d52abbd53070ab))
* add shared workflow connections and enhance webhook handling ([#166](https://github.com/Auxx-Ai/auxx-ai/issues/166)) ([ecc0f47](https://github.com/Auxx-Ai/auxx-ai/commit/ecc0f47b145481c98e6f4d8a63e0d3278794ff00))
* add sharp package to serverExternalPackages and update dependencies in pnpm workspace ([#283](https://github.com/Auxx-Ai/auxx-ai/issues/283)) ([b9cebe4](https://github.com/Auxx-Ai/auxx-ai/commit/b9cebe4828db02129d42706ca528def1c0eeea79))
* add step to refresh SST state before deployment ([f5f7198](https://github.com/Auxx-Ai/auxx-ai/commit/f5f7198fe237b4fc78e18da978b17a4449f39602))
* add support for app screenshots and enhance icon handling ([#153](https://github.com/Auxx-Ai/auxx-ai/issues/153)) ([7626230](https://github.com/Auxx-Ai/auxx-ai/commit/76262300afffbf10a1ccefccd14d14bf9573c119))
* add support for required apps and entities in workflow templates ([#291](https://github.com/Auxx-Ai/auxx-ai/issues/291)) ([80f6f0c](https://github.com/Auxx-Ai/auxx-ai/commit/80f6f0c01771cf9311da83bf5eaf53ea8e49f8da))
* add table view context and field view configuration ([cfa4ed3](https://github.com/Auxx-Ai/auxx-ai/commit/cfa4ed3de53b0b2268b535c5a09a0d23299c5527))
* add tag and thread entities with associated fields and queries ([6a9b38a](https://github.com/Auxx-Ai/auxx-ai/commit/6a9b38a62b6963f9a9896140cc02d204bfb50d08))
* add translucent variant to AvatarUpload, BillingCycleToggle, HorizontalPlanCard, PlanCard ([#317](https://github.com/Auxx-Ai/auxx-ai/issues/317)) ([912abc5](https://github.com/Auxx-Ai/auxx-ai/commit/912abc5319bc9c47a9e1abee3889f8490a9561e1))
* add troubleshooting and workspace documentation ([#207](https://github.com/Auxx-Ai/auxx-ai/issues/207)) ([6494633](https://github.com/Auxx-Ai/auxx-ai/commit/64946331999576fd088161860e68948df0cceefd))
* add tsdown dependency to pnpm workspace ([#91](https://github.com/Auxx-Ai/auxx-ai/issues/91)) ([41b4b5d](https://github.com/Auxx-Ai/auxx-ai/commit/41b4b5dc9f7df9b7de59e2c8e8887f7dc5b12e09))
* add user ban and force password change functionality and build … ([#184](https://github.com/Auxx-Ai/auxx-ai/issues/184)) ([007649c](https://github.com/Auxx-Ai/auxx-ai/commit/007649c7efe629543786f5d002d24a83353f0ac4))
* add useViewMutations hook for managing table views with store synchronization ([8d829b1](https://github.com/Auxx-Ai/auxx-ai/commit/8d829b1827d6824183ca89c72577e145b31063a1))
* add variable availability and graph computation modules ([#295](https://github.com/Auxx-Ai/auxx-ai/issues/295)) ([17cc47a](https://github.com/Auxx-Ai/auxx-ai/commit/17cc47aefc3846dcf0f59104390257ce11a2b43d))
* add verified badge to app schema and related services ([#229](https://github.com/Auxx-Ai/auxx-ai/issues/229)) ([b30face](https://github.com/Auxx-Ai/auxx-ai/commit/b30face4031cfa91aa8f61a70b15c52513586091))
* add warm configuration for production environments in Next.js apps ([#108](https://github.com/Auxx-Ai/auxx-ai/issues/108)) ([680e2c2](https://github.com/Auxx-Ai/auxx-ai/commit/680e2c286d4e23c60dc890b5e77923d248607c3e))
* app cache providers and implement new app slug and published apps providers ([#290](https://github.com/Auxx-Ai/auxx-ai/issues/290)) ([8e968bd](https://github.com/Auxx-Ai/auxx-ai/commit/8e968bd9a51b3d9fa7b49a97befccd88e34407ea))
* cache permissions and member queries to utilize organization cache ([#272](https://github.com/Auxx-Ai/auxx-ai/issues/272)) ([cd56921](https://github.com/Auxx-Ai/auxx-ai/commit/cd56921546e55f19bfbac6597fb065c76fc81656))
* check deployment ([e74aac1](https://github.com/Auxx-Ai/auxx-ai/commit/e74aac11e4df024b6f72a47a2833eba4cab7f7a0))
* check sst deploy ([#69](https://github.com/Auxx-Ai/auxx-ai/issues/69)) ([42058b9](https://github.com/Auxx-Ai/auxx-ai/commit/42058b9210c11b016603197e4a71d4b7a71337f4))
* code structure for improved readability and maintainability ([#104](https://github.com/Auxx-Ai/auxx-ai/issues/104)) ([39bcbc2](https://github.com/Auxx-Ai/auxx-ai/commit/39bcbc2171e9a8f8c4accd16e93a84c1f68af4d2))
* **database:** add index for entity instance and update timestamps ([a98f310](https://github.com/Auxx-Ai/auxx-ai/commit/a98f3109c35833e54df5df41e1955620dd642825))
* **database:** implement environment variable management for DATABAS… ([#23](https://github.com/Auxx-Ai/auxx-ai/issues/23)) ([5f0c6a4](https://github.com/Auxx-Ai/auxx-ai/commit/5f0c6a4193a4dcbdbcf3e2cbdbbd9ab79e387ccd))
* deploy ([73ab0eb](https://github.com/Auxx-Ai/auxx-ai/commit/73ab0ebecc6e41397827813b7a018640f4e34b2f))
* **dialog:** add DialogFieldConfigRow component for configurable field visibility and ordering ([6233347](https://github.com/Auxx-Ai/auxx-ai/commit/62333476d9b685db2edb43024a4b65b9a2ab60f2))
* **dialogs:** enhance dialog forms with keyboard shortcuts for submission ([6093510](https://github.com/Auxx-Ai/auxx-ai/commit/60935109fbac88058465b9dd89619ad52fe758e8))
* docs added dataset, files, tasks ([#202](https://github.com/Auxx-Ai/auxx-ai/issues/202)) ([b1ec3ca](https://github.com/Auxx-Ai/auxx-ai/commit/b1ec3cabd098ebe03c1e6cc30db283949045f86c))
* documentation for dialog API, storage, and various UI components ([#208](https://github.com/Auxx-Ai/auxx-ai/issues/208)) ([e78508d](https://github.com/Auxx-Ai/auxx-ai/commit/e78508ddb49d32ec71653cabd60b5643c361b4f5))
* **drafts:** add batch fetching of standalone draft metadata ([38704a9](https://github.com/Auxx-Ai/auxx-ai/commit/38704a9a163b8884bd226becbac0040cbfb916a2))
* **drawers:** implement BaseEntityDrawer and associated tab components ([8b1fbea](https://github.com/Auxx-Ai/auxx-ai/commit/8b1fbea5f93d85faf026bd2e98a87a4c08af61cc))
* **editor:** enhance draft handling with inReplyToMessageId and includePreviousMessage support ([2ed28a6](https://github.com/Auxx-Ai/auxx-ai/commit/2ed28a63988f400f3cfb03a9e5c295eeca81f49b))
* enhance  entityDefinitionId support and improving var label resolution in workflow ([#296](https://github.com/Auxx-Ai/auxx-ai/issues/296)) ([c9e50d5](https://github.com/Auxx-Ai/auxx-ai/commit/c9e50d56c432a6cf94f9f7406ebc3ab770c1439c))
* Enhance actor handling and UI components ([df5b6d7](https://github.com/Auxx-Ai/auxx-ai/commit/df5b6d79edf69f47c17d9ddd16ab6ea73914c8b3))
* enhance AIProcessorV2 to support file attachments and improve file handling ([#348](https://github.com/Auxx-Ai/auxx-ai/issues/348)) ([b35dbb1](https://github.com/Auxx-Ai/auxx-ai/commit/b35dbb12cd017b668b182588d4f95de448591d19))
* enhance app access checks and installation queries for improved… ([#201](https://github.com/Auxx-Ai/auxx-ai/issues/201)) ([2e59042](https://github.com/Auxx-Ai/auxx-ai/commit/2e59042b3f0fb8316a851575e64da5bffb2a91d1))
* enhance application URL management and Redis config ([#76](https://github.com/Auxx-Ai/auxx-ai/issues/76)) ([ef51730](https://github.com/Auxx-Ai/auxx-ai/commit/ef51730cd427c7c0d27dc715c98a34b86cdadea5))
* enhance cache invalidation and workflow limits ([#279](https://github.com/Auxx-Ai/auxx-ai/issues/279)) ([f0e424f](https://github.com/Auxx-Ai/auxx-ai/commit/f0e424f26053f7d4d54421e345ba7de7f9802c73))
* enhance compose editor with pop-out, minimize, and dock-back functionality ([#320](https://github.com/Auxx-Ai/auxx-ai/issues/320)) ([0c5d2a5](https://github.com/Auxx-Ai/auxx-ai/commit/0c5d2a57fc89dba1790ea078e2c5046f2f9428da))
* enhance condition badge and search functionality ([#269](https://github.com/Auxx-Ai/auxx-ai/issues/269)) ([d2a4bf7](https://github.com/Auxx-Ai/auxx-ai/commit/d2a4bf74aee7bf384cf9d2c77f5e8db9e5a7953d))
* enhance condition item and input components to support metadata in value change callbacks ([#324](https://github.com/Auxx-Ai/auxx-ai/issues/324)) ([9892211](https://github.com/Auxx-Ai/auxx-ai/commit/98922110d4efdf067f12b2e5e54eb6a539a914fd))
* enhance custom field dialogs and entity management with improved state handling and UI updates ([c465018](https://github.com/Auxx-Ai/auxx-ai/commit/c4650180cf18271b5dd219f8e6b0655d1394b0ab))
* enhance custom field editors with inverse name handling ([02b9dec](https://github.com/Auxx-Ai/auxx-ai/commit/02b9dec742755f9f2880f9702b94fd70d79eab7a))
* Enhance custom field management with optimistic updates and new API endpoints ([d8a5880](https://github.com/Auxx-Ai/auxx-ai/commit/d8a58803e3572da78df7a7f27b4c91bc2bb4d88c))
* enhance custom field row with copy functionality and badge for system fields ([3f4b99f](https://github.com/Auxx-Ai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* enhance custom fields with ACTOR type support ([b0c45f6](https://github.com/Auxx-Ai/auxx-ai/commit/b0c45f6684b7f9d2ffec52312a75234c6bf09071))
* enhance date handling and ticket integration ([#311](https://github.com/Auxx-Ai/auxx-ai/issues/311)) ([3d67285](https://github.com/Auxx-Ai/auxx-ai/commit/3d6728530204b186fcac7498270fbac0604868e1))
* enhance developer documentation and add redirect for missing slugs ([#209](https://github.com/Auxx-Ai/auxx-ai/issues/209)) ([67368dc](https://github.com/Auxx-Ai/auxx-ai/commit/67368dc9b18d726540de7d35d38fdd4f8b9b4d59))
* enhance Docker workflows and application metadata with build in… ([#110](https://github.com/Auxx-Ai/auxx-ai/issues/110)) ([74f61c7](https://github.com/Auxx-Ai/auxx-ai/commit/74f61c7f3d78e7575d3d266dcfefe884e9321af5))
* enhance docker-entrypoint.sh to support multiple URL replacements ([#118](https://github.com/Auxx-Ai/auxx-ai/issues/118)) ([73280b0](https://github.com/Auxx-Ai/auxx-ai/commit/73280b061f5706291761dfc8494b4069cdb835e4))
* enhance draft service with lightweight draft queries ([f094994](https://github.com/Auxx-Ai/auxx-ai/commit/f094994c83d4fe6e300002e1875a439034b6f6eb))
* Enhance dynamic table functionality with reconciled columns and dynamic field creation ([2c80586](https://github.com/Auxx-Ai/auxx-ai/commit/2c80586f045b7737c7ac4e5a91abbe8c31b77f71))
* Enhance entity instance dialog initialization and prevent unnecessary resets ([af59fdb](https://github.com/Auxx-Ai/auxx-ai/commit/af59fdbfd7d7c34507272698c8ca65c439f62ab3))
* enhance entity instance fields with system attribute support ([3f4b99f](https://github.com/Auxx-Ai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* enhance entity records content and related components for improved field handling and visibility management ([5f9e92f](https://github.com/Auxx-Ai/auxx-ai/commit/5f9e92f0ab3259ebba239075b95510a5494d6120))
* enhance error handling in ConfigService and add TLS support in … ([#98](https://github.com/Auxx-Ai/auxx-ai/issues/98)) ([fba1f52](https://github.com/Auxx-Ai/auxx-ai/commit/fba1f521a84a9e2829c631df32466e448cddfb9a))
* Enhance field value handling and registry structure ([b94678f](https://github.com/Auxx-Ai/auxx-ai/commit/b94678f61411d6baee6775cfe2ef7e0c3b5d1327))
* Enhance field value handling with mutation version tracking and improved save responses ([4b01750](https://github.com/Auxx-Ai/auxx-ai/commit/4b01750cc8a859739a997a40bf8bc29a4c122ef5))
* Enhance field value retrieval with relationship traversal support ([e8c035f](https://github.com/Auxx-Ai/auxx-ai/commit/e8c035f54dca228fb8754606e9a3d03f4d1194d9))
* enhance filter builder and find panel with resource field ID handling ([#299](https://github.com/Auxx-Ai/auxx-ai/issues/299)) ([0707884](https://github.com/Auxx-Ai/auxx-ai/commit/07078844601cf6c155f2a4e96d94b82ff7e78751))
* enhance inline-picker and mention editor with pattern preprocessing and improved badge rendering ([1e78883](https://github.com/Auxx-Ai/auxx-ai/commit/1e78883ca5bcf3de7a8aa6e66543bb798828bb55))
* enhance integration sync status handling and add related tests ([#32](https://github.com/Auxx-Ai/auxx-ai/issues/32)) ([54b2ece](https://github.com/Auxx-Ai/auxx-ai/commit/54b2ececa9c71f90df78ce5ee978da0bf15ed1ca))
* enhance internal URL handling for Lambda execution and improve dev server binding ([#236](https://github.com/Auxx-Ai/auxx-ai/issues/236)) ([d4c848a](https://github.com/Auxx-Ai/auxx-ai/commit/d4c848a59d67ffa2c54fe972e7cdefbe24265052))
* enhance loading state management with auto-fetch and layout effects in hooks ([2aa5a1d](https://github.com/Auxx-Ai/auxx-ai/commit/2aa5a1dbf00fd20b9f24c28b273ea35d6e504487))
* enhance logging and security measures, implement CSRF protection for OAuth flows ([#264](https://github.com/Auxx-Ai/auxx-ai/issues/264)) ([3dec1c7](https://github.com/Auxx-Ai/auxx-ai/commit/3dec1c773d783e28e846ec678303191f6750ac14))
* enhance logging for Lambda invocation and error handling ([#234](https://github.com/Auxx-Ai/auxx-ai/issues/234)) ([56df230](https://github.com/Auxx-Ai/auxx-ai/commit/56df230dc13d79fd41b4751b386207bb44af07fd))
* enhance logging for Pusher auth and session verification processes ([#137](https://github.com/Auxx-Ai/auxx-ai/issues/137)) ([0f51f24](https://github.com/Auxx-Ai/auxx-ai/commit/0f51f244487ac57cfcbe4f4150762ba8ecb641c7))
* enhance mail search functionality; add search scope condition and improve participant display ([#268](https://github.com/Auxx-Ai/auxx-ai/issues/268)) ([a13ea7f](https://github.com/Auxx-Ai/auxx-ai/commit/a13ea7f826b872ff351c9ec19624043f5491f3f3))
* enhance ManualTriggerProcessor to support file input handling and streamline variable setting ([#349](https://github.com/Auxx-Ai/auxx-ai/issues/349)) ([814f940](https://github.com/Auxx-Ai/auxx-ai/commit/814f940963d1dcc9d6ed99deab13ea285baa825a))
* enhance message handling with replyAll option and auto-resolve features ([#315](https://github.com/Auxx-Ai/auxx-ai/issues/315)) ([15fd30e](https://github.com/Auxx-Ai/auxx-ai/commit/15fd30e1e586826b0558b377e8f48ef87abd3e51))
* enhance multi-select functionality with create and manage optio… ([#177](https://github.com/Auxx-Ai/auxx-ai/issues/177)) ([0309c92](https://github.com/Auxx-Ai/auxx-ai/commit/0309c928b342f686563709c710dd677a28148ea4))
* enhance Outlook integration with error handling ([#73](https://github.com/Auxx-Ai/auxx-ai/issues/73)) ([9f13d84](https://github.com/Auxx-Ai/auxx-ai/commit/9f13d84d376d113d25446cd6562b8841db171a57))
* enhance output variable handling and introduce VarEditor compon… ([#155](https://github.com/Auxx-Ai/auxx-ai/issues/155)) ([c8c2572](https://github.com/Auxx-Ai/auxx-ai/commit/c8c2572d8548f67d2970c8836fe298615ddaad77))
* enhance part and ticket fields with system attributes ([a03640a](https://github.com/Auxx-Ai/auxx-ai/commit/a03640a590db5a3e1f3a4e9f8d614ec4fd770eec))
* enhance polling trigger execution with error handling and workflow run creation ([#247](https://github.com/Auxx-Ai/auxx-ai/issues/247)) ([6fd8b5f](https://github.com/Auxx-Ai/auxx-ai/commit/6fd8b5fab26f98a4604b591fbde2f0395f586c23))
* enhance preflight check scripts to strip quotes and manage SST variables ([84d5131](https://github.com/Auxx-Ai/auxx-ai/commit/84d513135af830d381f978b5b2eb25a33ed6c1cc))
* enhance README and install script; add SVG banner and improve installation process ([#263](https://github.com/Auxx-Ai/auxx-ai/issues/263)) ([bede7cf](https://github.com/Auxx-Ai/auxx-ai/commit/bede7cf4c3391bef48f7776e2739983349b362ba))
* enhance record picker with external search and item selection callbacks ([#240](https://github.com/Auxx-Ai/auxx-ai/issues/240)) ([28bdc55](https://github.com/Auxx-Ai/auxx-ai/commit/28bdc5514ebb7b3ac038165fc56f00b12fa47263))
* enhance Redis and Facebook/Instagram OAuth services ([#94](https://github.com/Auxx-Ai/auxx-ai/issues/94)) ([b494352](https://github.com/Auxx-Ai/auxx-ai/commit/b494352d32aa3d921ac599e8044ee622836c70b1))
* enhance Redis client and configuration management ([#92](https://github.com/Auxx-Ai/auxx-ai/issues/92)) ([a1c859f](https://github.com/Auxx-Ai/auxx-ai/commit/a1c859f467a8e0bc3e996a3796ce249e278f6c48))
* enhance resource handling with ResourceId type and utility functions ([53aa1ec](https://github.com/Auxx-Ai/auxx-ai/commit/53aa1ec93bf1afa8cd6cc2e7d87937fd59d84960))
* enhance S3 client configuration with environment variable suppo… ([#192](https://github.com/Auxx-Ai/auxx-ai/issues/192)) ([d32cfeb](https://github.com/Auxx-Ai/auxx-ai/commit/d32cfeb01f416521d20b279817c2571651522835))
* enhance SDK publish workflow and add repository metadata ([#129](https://github.com/Auxx-Ai/auxx-ai/issues/129)) ([622ce55](https://github.com/Auxx-Ai/auxx-ai/commit/622ce5550af907cf496db3501d60a636e2beffc3))
* enhance SDK publish workflow with preflight checks ([#128](https://github.com/Auxx-Ai/auxx-ai/issues/128)) ([226594c](https://github.com/Auxx-Ai/auxx-ai/commit/226594c495bcad2b8d568313000317dfb083e07a))
* enhance search functionality and UI components ([ca06b38](https://github.com/Auxx-Ai/auxx-ai/commit/ca06b389468b1887957085e5871792ad3caf46d5))
* enhance SST deploy workflow with concurrency and AWS identity verification ([a070893](https://github.com/Auxx-Ai/auxx-ai/commit/a0708930eabc61691a23c07e53e961c53de0c3fd))
* enhance system condition builder and UI components ([#327](https://github.com/Auxx-Ai/auxx-ai/issues/327)) ([3f2937d](https://github.com/Auxx-Ai/auxx-ai/commit/3f2937d43fc4884f819558b3a77c08fb677f9ac0))
* Enhance task management with deadline handling and completed task filtering ([a29f75c](https://github.com/Auxx-Ai/auxx-ai/commit/a29f75c1caf5fcaf637b7f1902a0f3d17b37189e))
* enhance template transform with default assignees for human-confirmation nodes ([#334](https://github.com/Auxx-Ai/auxx-ai/issues/334)) ([a2e58ba](https://github.com/Auxx-Ai/auxx-ai/commit/a2e58ba0c4f47b0fb848b3354c715cfe7e4d9c7f))
* enhance ticket dashboard and badge components ([#205](https://github.com/Auxx-Ai/auxx-ai/issues/205)) ([16f7dfc](https://github.com/Auxx-Ai/auxx-ai/commit/16f7dfc7687b79f38b461c24b69dc41df0877190))
* enhance type operator map and condition builders ([1cf2a41](https://github.com/Auxx-Ai/auxx-ai/commit/1cf2a411814d9fd811c1980a7d9fb725a7bb92f7))
* enhance UI components and improve accessibility ([#330](https://github.com/Auxx-Ai/auxx-ai/issues/330)) ([980b595](https://github.com/Auxx-Ai/auxx-ai/commit/980b595936711d9d29ed68ae2811e4af9cd63e00))
* enhance UI components with keyboard shortcuts and collapsible sections ([55fb1e8](https://github.com/Auxx-Ai/auxx-ai/commit/55fb1e8b713582166351c6a2a7e258137c2fa520))
* enhance user profile management and organization settings ([#242](https://github.com/Auxx-Ai/auxx-ai/issues/242)) ([13b46bd](https://github.com/Auxx-Ai/auxx-ai/commit/13b46bdc570eb82c6a1f6d5facc9d247f590bc4b))
* enhance workflow block error handling and validation ([#163](https://github.com/Auxx-Ai/auxx-ai/issues/163)) ([eb9a214](https://github.com/Auxx-Ai/auxx-ai/commit/eb9a214da450d310e33682274260d8cb01869e40))
* enhance workflow components with improved event handling and UI updates ([#341](https://github.com/Auxx-Ai/auxx-ai/issues/341)) ([90c5748](https://github.com/Auxx-Ai/auxx-ai/commit/90c5748674d2c0b5600ecf2a1b03c9851abcacb7))
* **entity-instances:** extend entity instance creation parameters ([56ded83](https://github.com/Auxx-Ai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))
* Feat/workflow crud ([#10](https://github.com/Auxx-Ai/auxx-ai/issues/10)) ([c5d300c](https://github.com/Auxx-Ai/auxx-ai/commit/c5d300cf803e73b6c8eb66575740a2e1c930244a))
* finalize dynamic table refactor - replace all legacy files ([8315f2d](https://github.com/Auxx-Ai/auxx-ai/commit/8315f2d4d8e8eec7fd492462af9902d88dffdd07))
* fix conditions ([#312](https://github.com/Auxx-Ai/auxx-ai/issues/312)) ([763be20](https://github.com/Auxx-Ai/auxx-ai/commit/763be2028b4eabaeaa2cda664b7232b6d7d3d528))
* **groups:** add entity group management functionality ([bbaeb07](https://github.com/Auxx-Ai/auxx-ai/commit/bbaeb07628dc1f4619d3562d70d42643adec7371))
* homepage dark mode, svg components ([#194](https://github.com/Auxx-Ai/auxx-ai/issues/194)) ([dd8bf5f](https://github.com/Auxx-Ai/auxx-ai/commit/dd8bf5ff7cc3b5660124d7fd0e0b91f8a9afdf18))
* implement Actor handling across components and services, enhancing actor data extraction and display ([25695aa](https://github.com/Auxx-Ai/auxx-ai/commit/25695aa83c855a523c0faa88b805c799b03a4a0d))
* implement app-wide caching for plans and workflow templates ([#273](https://github.com/Auxx-Ai/auxx-ai/issues/273)) ([9a874c5](https://github.com/Auxx-Ai/auxx-ai/commit/9a874c575b07f60669bedafb712fdff3eb8bbb30))
* implement ArrayInput component with drag-and-drop functionality… ([#180](https://github.com/Auxx-Ai/auxx-ai/issues/180)) ([9fd9de8](https://github.com/Auxx-Ai/auxx-ai/commit/9fd9de8e0df491a043769c26cca6e40e2be7437a))
* implement attachment fetching and inbound content ingestion ([#252](https://github.com/Auxx-Ai/auxx-ai/issues/252)) ([1554fc7](https://github.com/Auxx-Ai/auxx-ai/commit/1554fc7e3f6d3f742caf65372e7ded1f13aeb102))
* implement AutoplayVideo component and replace video tags across multiple sections ([#340](https://github.com/Auxx-Ai/auxx-ai/issues/340)) ([9efd0d1](https://github.com/Auxx-Ai/auxx-ai/commit/9efd0d18d037c938e90b6b3b0e015e13b3adff22))
* implement CDN video URL handling and block demo users from accessing developer portal ([#343](https://github.com/Auxx-Ai/auxx-ai/issues/343)) ([45f0045](https://github.com/Auxx-Ai/auxx-ai/commit/45f0045747e490ceb47bceeae046a1528283fb54))
* implement computed field functionality with caching and automatic invalidation ([33ded19](https://github.com/Auxx-Ai/auxx-ai/commit/33ded192bc5a5944b8550e350f0d7058559669a7))
* implement config context and refactor components to use it ([#196](https://github.com/Auxx-Ai/auxx-ai/issues/196)) ([6a6685e](https://github.com/Auxx-Ai/auxx-ai/commit/6a6685e8f597bd45a63ce1aa37ae839f0ddd9e96))
* implement contact hooks for validation and normalization ([060f1bc](https://github.com/Auxx-Ai/auxx-ai/commit/060f1bcf59f0ebe914f75bf32237f1bfc69fb22e))
* implement country selection component and integrate into forms ([#285](https://github.com/Auxx-Ai/auxx-ai/issues/285)) ([e4bbb65](https://github.com/Auxx-Ai/auxx-ai/commit/e4bbb65ff0c7bcf1ffeddec1a0f203c50c902f5d))
* Implement custom field value store and hydration logic ([6dbfb6b](https://github.com/Auxx-Ai/auxx-ai/commit/6dbfb6ba55872e6c31edb93ec0a380b44baef8ab))
* implement email job processing and worker for transactional emails ([#75](https://github.com/Auxx-Ai/auxx-ai/issues/75)) ([c848a0a](https://github.com/Auxx-Ai/auxx-ai/commit/c848a0a58b806ba21832c4996fea6f31b8e2a1ef))
* Implement entity merging functionality ([3bea692](https://github.com/Auxx-Ai/auxx-ai/commit/3bea692cb4bdc1c8309a9831e89ac1f402e7856b))
* implement fallback state for dehydration failures in PortalLayout ([#135](https://github.com/Auxx-Ai/auxx-ai/issues/135)) ([4c9eba9](https://github.com/Auxx-Ai/auxx-ai/commit/4c9eba98c0bcf2bb4bd24b9f0b7e498e264da17c))
* implement field path breadcrumbs and enhance column ID handling for dynamic tables ([92ac001](https://github.com/Auxx-Ai/auxx-ai/commit/92ac0015f7a014020931eced83bcc61ac9be776e))
* Implement field value fetch queue and enhance auto-fetch capabilities for field values ([aaa60cd](https://github.com/Auxx-Ai/auxx-ai/commit/aaa60cdcbf7e182b90ce09fefd30107919fdc02a))
* implement FieldDisplay component for read-only field rendering and refactor display components to use useFieldContext hook ([248002e](https://github.com/Auxx-Ai/auxx-ai/commit/248002ea9435750d8accc76673b37963e01d1a6d))
* implement Gmail attachment fetching and inbound content ingestion ([#243](https://github.com/Auxx-Ai/auxx-ai/issues/243)) ([b938238](https://github.com/Auxx-Ai/auxx-ai/commit/b938238a9625ec6b2b1e575a7e911f5ce699b14a))
* implement HMAC signing for Lambda invocations and add callback … ([#145](https://github.com/Auxx-Ai/auxx-ai/issues/145)) ([36e1156](https://github.com/Auxx-Ai/auxx-ai/commit/36e1156a588da3a4339ea88288296388b7b65e8d))
* implement IMAP full sync with windowed UID scanning and checkpo… ([#226](https://github.com/Auxx-Ai/auxx-ai/issues/226)) ([7810390](https://github.com/Auxx-Ai/auxx-ai/commit/7810390489a0fff7d3fea835c1cab63f98b3cedd))
* implement import functionality for apps with validation and ups… ([#175](https://github.com/Auxx-Ai/auxx-ai/issues/175)) ([1c4d8a3](https://github.com/Auxx-Ai/auxx-ai/commit/1c4d8a3b78ff2495a0d0410fe89fd15975846cc4))
* implement inbound email attachment and body processing services ([#241](https://github.com/Auxx-Ai/auxx-ai/issues/241)) ([09a0cc1](https://github.com/Auxx-Ai/auxx-ai/commit/09a0cc19e0804b4eb0f5d67e3ce6b900f1012502))
* implement inbound email processing pipeline with S3 integration ([#216](https://github.com/Auxx-Ai/auxx-ai/issues/216)) ([b7b7c13](https://github.com/Auxx-Ai/auxx-ai/commit/b7b7c13c1f2074fd994dc41b309b37f72ba477ac))
* implement inline app install button and enhance extensions context for installation management ([#306](https://github.com/Auxx-Ai/auxx-ai/issues/306)) ([ba2829c](https://github.com/Auxx-Ai/auxx-ai/commit/ba2829c0b6a66fb8ec5d023f07ca675692be7860))
* implement inline email attachment handling and processing ([#238](https://github.com/Auxx-Ai/auxx-ai/issues/238)) ([1314b81](https://github.com/Auxx-Ai/auxx-ai/commit/1314b81a7a653c69d668703e477d949fa203c099))
* implement internal authentication middleware and update auth ha… ([#148](https://github.com/Auxx-Ai/auxx-ai/issues/148)) ([4f4c510](https://github.com/Auxx-Ai/auxx-ai/commit/4f4c5105fa48af0136eb0b648832e53947540e3d))
* implement meteors component and enhance layout responsiveness in mail section ([#322](https://github.com/Auxx-Ai/auxx-ai/issues/322)) ([538efb5](https://github.com/Auxx-Ai/auxx-ai/commit/538efb5d1efa38914a57122f4592145ff2ce0074))
* Implement name input handling and dialog mode for email editor ([ffdb86f](https://github.com/Auxx-Ai/auxx-ai/commit/ffdb86f1448201860852c2ecbec9be700225da90))
* implement optimistic updates for entity definitions and enhance resource store management ([fea13ef](https://github.com/Auxx-Ai/auxx-ai/commit/fea13ef693d4143a86d2386f5057487d27ff0d63))
* implement optimistic updates for thread mutations and refactor thread list management ([d40094d](https://github.com/Auxx-Ai/auxx-ai/commit/d40094df70c15caf2a54c01a456a7473626ddbc5))
* implement org-level config management for Google and Outlook integrations ([#294](https://github.com/Auxx-Ai/auxx-ai/issues/294)) ([b40b2bc](https://github.com/Auxx-Ai/auxx-ai/commit/b40b2bc96a8e055c27c228aa7a212ab50c222a3d))
* implement orphaned app bundle cleanup job and related scheduling ([#188](https://github.com/Auxx-Ai/auxx-ai/issues/188)) ([d9f16a6](https://github.com/Auxx-Ai/auxx-ai/commit/d9f16a6fb12d3c5e7f78edfbc1dba3717617fc69))
* implement playwright testing ([#87](https://github.com/Auxx-Ai/auxx-ai/issues/87)) ([d38f5d3](https://github.com/Auxx-Ai/auxx-ai/commit/d38f5d3b30a20ab745ab5e2fc481a99e72cce90c))
* implement queue metrics and job runs management with clear fail… ([#124](https://github.com/Auxx-Ai/auxx-ai/issues/124)) ([c48af6c](https://github.com/Auxx-Ai/auxx-ai/commit/c48af6c6d0efd07f8f2deb9b18fe087c04ec8236))
* implement record field caching and lazy loading for improved performance ([#326](https://github.com/Auxx-Ai/auxx-ai/issues/326)) ([f4ffc2a](https://github.com/Auxx-Ai/auxx-ai/commit/f4ffc2aba387a31a36e1f7bec98c06a2743d53f8))
* Implement Resource Picker Component ([2233a70](https://github.com/Auxx-Ai/auxx-ai/commit/2233a70ccb146f6025fa0e2ecb122d40dc35df84))
* implement ResourceBadge component and enhance resource linking utilities ([0785746](https://github.com/Auxx-Ai/auxx-ai/commit/078574663d93f4d1e81eb88828a9235fe091a0c8))
* Implement ResourcePicker component with field selection and relationship drill-down functionality ([0e7673f](https://github.com/Auxx-Ai/auxx-ai/commit/0e7673f013103bd466fcc97af65cd73510a1dfb7))
* Implement session filters for dynamic table and enhance view management ([8f989e4](https://github.com/Auxx-Ai/auxx-ai/commit/8f989e4af257927a577f63b78a2dca57d10c7209))
* implement shared resize context and provider for responsive components ([c448b90](https://github.com/Auxx-Ai/auxx-ai/commit/c448b90eb75faf33347f129590a347e47d371552))
* implement storage cleanup job for async S3 object deletion and Redis cache clearing ([#246](https://github.com/Auxx-Ai/auxx-ai/issues/246)) ([768da67](https://github.com/Auxx-Ai/auxx-ai/commit/768da6742d0a7c0bc2fc81e4b426ab29362f7eea))
* implement table UI store and view store for dynamic table management ([4a95e2d](https://github.com/Auxx-Ai/auxx-ai/commit/4a95e2d4ca307be2ecc19fa34c602ffa43b80f03))
* implement two-phase polling sync for Google and Outlook integra… ([#71](https://github.com/Auxx-Ai/auxx-ai/issues/71)) ([dd1ef42](https://github.com/Auxx-Ai/auxx-ai/commit/dd1ef4213c4d63231ada0dd2bfbe42ed622ec6c1))
* Implement unified handler for CRUD operations ([44630cc](https://github.com/Auxx-Ai/auxx-ai/commit/44630cc29b9294714b2d30c0568dd4373b1a5637))
* implement usage limits and tracking for AI completions, outbound emails ([#251](https://github.com/Auxx-Ai/auxx-ai/issues/251)) ([4b2f497](https://github.com/Auxx-Ai/auxx-ai/commit/4b2f497183c8a5d5e75fc0c1303ff55771c67233))
* implement useResources hook for better resource management ([3f4b99f](https://github.com/Auxx-Ai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* implement useWorkflowVariableEditor hook and refactor variable editing components with inline-picker support ([2a60b02](https://github.com/Auxx-Ai/auxx-ai/commit/2a60b022e5423f0c3c904b6be3b21f80e6e55a9a))
* **inbox:** update field keys to use inbox_ prefix for consistency ([59ac6c6](https://github.com/Auxx-Ai/auxx-ai/commit/59ac6c66dede29bdfc9bf2effec03b6952d4d4d8))
* integrate Cloudflare Turnstile for enhanced security in signup … ([#186](https://github.com/Auxx-Ai/auxx-ai/issues/186)) ([e230559](https://github.com/Auxx-Ai/auxx-ai/commit/e230559b7e55e3e85f013e964be9cf710bb89960))
* integrate ComboPicker for field type selection in CustomFieldDialog ([0a499aa](https://github.com/Auxx-Ai/auxx-ai/commit/0a499aa0c7f5a1f5efd30a7ab686df066cb82361))
* integrate demo data seeding and configurations ([#302](https://github.com/Auxx-Ai/auxx-ai/issues/302)) ([e995771](https://github.com/Auxx-Ai/auxx-ai/commit/e99577167ff7b6e69209b5723360cd087d6b9c9f))
* integrate mail filter context into search bar to conditionally display scope badge ([#319](https://github.com/Auxx-Ai/auxx-ai/issues/319)) ([99e8b35](https://github.com/Auxx-Ai/auxx-ai/commit/99e8b35e581230c0def9148521aa2b809167d160))
* integrate react-hotkeys for keyboard shortcuts in workflow and threads ([fffbc25](https://github.com/Auxx-Ai/auxx-ai/commit/fffbc252d62f7178927e6a61d5a7b18f8a258cf9))
* introduce ID-first batch-fetch methods in thread query service ([f094994](https://github.com/Auxx-Ai/auxx-ai/commit/f094994c83d4fe6e300002e1875a439034b6f6eb))
* Introduce unified condition-based filtering for threads ([4e4f152](https://github.com/Auxx-Ai/auxx-ai/commit/4e4f1522c42c16d61f882c200d02222e6538df3c))
* **mail:** implement full counts for sidebar and optimize thread read status updates ([78a0f6f](https://github.com/Auxx-Ai/auxx-ai/commit/78a0f6fc0acfc15e5aa6e9dfe9e4800d8cf09717))
* **members:** add membership retrieval and active member count methods ([56ded83](https://github.com/Auxx-Ai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))
* **organizations:** refactor owner verification to use membership service ([56ded83](https://github.com/Auxx-Ai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))
* **phone-input:** update CountrySelect button styles and remove unused icon ([836a9ad](https://github.com/Auxx-Ai/auxx-ai/commit/836a9adebb871ecfa9e7b22720258bafbe84e7d2))
* **redis:** add set operations to Redis clients ([56ded83](https://github.com/Auxx-Ai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))
* Refactor CRUD handlers to utilize ResourceId for custom fields ([0435953](https://github.com/Auxx-Ai/auxx-ai/commit/04359532bcae2628fde3adc7e658a3bbfe4cd436))
* Refactor custom field handling and improve resource field management ([480e853](https://github.com/Auxx-Ai/auxx-ai/commit/480e8539234c31282b8775d96b423e86d91d3241))
* refactor custom fields to support primary display field auto-setting and remove text input node ([a234648](https://github.com/Auxx-Ai/auxx-ai/commit/a234648f9061376431064c4d4df8606433818a33))
* refactor dehydrated state management and organization context h… ([#122](https://github.com/Auxx-Ai/auxx-ai/issues/122)) ([e09ed48](https://github.com/Auxx-Ai/auxx-ai/commit/e09ed488eb86745637e7c5b257b09788c1aaa8d1))
* refactor email configuration and transport handling for S3 comp… ([#141](https://github.com/Auxx-Ai/auxx-ai/issues/141)) ([12899be](https://github.com/Auxx-Ai/auxx-ai/commit/12899bec507a24a305cea3aca386c4eafaccfc2d))
* refactor entity appearance editor to use resource object and disable editing for system resources ([3f4b99f](https://github.com/Auxx-Ai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* refactor EntityRecordDrawer and related components to use ResourceId format and enhance preset value handling ([b668ced](https://github.com/Auxx-Ai/auxx-ai/commit/b668ced767375b7e1e00fd57a6a4fbac055b0904))
* refactor field handling in calc editor, introduce FieldBadge component, and update formula conversion logic ([e0d6b23](https://github.com/Auxx-Ai/auxx-ai/commit/e0d6b23cf6ed00229af7d7d2c2912829ab32cf60))
* refactor field identification across resources ([5b8e1d1](https://github.com/Auxx-Ai/auxx-ai/commit/5b8e1d1a11897a049f68d725fcfbeee81bc0a408))
* Refactor field input handling and introduce FieldInputAdapter ([8f5662a](https://github.com/Auxx-Ai/auxx-ai/commit/8f5662a55d4b7a689d9571d1492d9a44d1dd8582))
* Refactor field value handling and relationship utilities ([c51713d](https://github.com/Auxx-Ai/auxx-ai/commit/c51713d65737462af25eaefe2f9400dfc8c26ed4))
* refactor field value handling to use useFieldValue hook for improved reactivity and performance ([e757077](https://github.com/Auxx-Ai/auxx-ai/commit/e7570779522f49254308a600b133ec264046d4b8))
* Refactor inbox and message handling ([848468f](https://github.com/Auxx-Ai/auxx-ai/commit/848468f83dadd6f8be8ff1971c4d694b082bd3de))
* refactor inbox retrieval methods to use listAll and improve transformation logic ([#270](https://github.com/Auxx-Ai/auxx-ai/issues/270)) ([1895a80](https://github.com/Auxx-Ai/auxx-ai/commit/1895a800041de9610d16ecd13e9d7e65fc2aa8f0))
* refactor onboarding components to use dehydrated state and improve organization management ([8db17c2](https://github.com/Auxx-Ai/auxx-ai/commit/8db17c2cb2e052934afb72b33614bf5ec07d27af))
* Refactor relationship handling to use inverseResourceFieldId and improve relationship config management ([4f03edc](https://github.com/Auxx-Ai/auxx-ai/commit/4f03edc0fd5c3ec36794050b8b4ec86ebb585b75))
* Refactor relationship sync and save field value handling for type-safe field identification ([5f26601](https://github.com/Auxx-Ai/auxx-ai/commit/5f26601c1c94f581e2275937d7db224be4dd618d))
* Refactor resource handling to use record IDs for consistency across components ([86f88e6](https://github.com/Auxx-Ai/auxx-ai/commit/86f88e665f15e56f574cc04744d68dc9b653f0c8))
* Refactor resource handling to use ResourceId format ([816deaf](https://github.com/Auxx-Ai/auxx-ai/commit/816deafd9a81775faa2ee53ae979aba939905176))
* refactor S3 client initialization and update download URL gener… ([#139](https://github.com/Auxx-Ai/auxx-ai/issues/139)) ([4f28860](https://github.com/Auxx-Ai/auxx-ai/commit/4f2886028373d92c8febfbd21681dfbce3ad1e00))
* refactor safety check script to use grep instead of ripgrep ([856e286](https://github.com/Auxx-Ai/auxx-ai/commit/856e286d6aca00dc9f0b1ecde3c36501c0a88af6))
* refactor Stripe initialization and dynamically load PlanChangeS… ([#120](https://github.com/Auxx-Ai/auxx-ai/issues/120)) ([60bac33](https://github.com/Auxx-Ai/auxx-ai/commit/60bac33504985ab3ff7d835beb131d522b71c290))
* refactor subscription handling and introduce recovery for past_due status ([#287](https://github.com/Auxx-Ai/auxx-ai/issues/287)) ([2857af9](https://github.com/Auxx-Ai/auxx-ai/commit/2857af905483f2fbc3ae518d3ed05f24698183c7))
* Refactor task assignment handling to use ActorId and implement concurrency semaphore for rate limiting ([4d9d3d2](https://github.com/Auxx-Ai/auxx-ai/commit/4d9d3d22b446952ad3486bd216673f4eab888f12))
* refactor task handling to use ResourceId format and update related components ([27d18e2](https://github.com/Auxx-Ai/auxx-ai/commit/27d18e2d1f745f35f394c54ebc980f80fe629879))
* refactor task management and UI components for improved functionality and user experience ([b46ebae](https://github.com/Auxx-Ai/auxx-ai/commit/b46ebaeb5486e973f79d64b876813c49d8af1795))
* Refactor ticket event types and hooks for improved event handling ([bd2b8f9](https://github.com/Auxx-Ai/auxx-ai/commit/bd2b8f971ea5ad331b834b6da0538c6154106497))
* refactor variable editor array component for improved usability and performance ([#297](https://github.com/Auxx-Ai/auxx-ai/issues/297)) ([1f32e1d](https://github.com/Auxx-Ai/auxx-ai/commit/1f32e1d3be7250116d61cecad32ce35e6f2319a1))
* remove export of constants from index file ([#131](https://github.com/Auxx-Ai/auxx-ai/issues/131)) ([e877f55](https://github.com/Auxx-Ai/auxx-ai/commit/e877f55e8148aae64a8d0b8c449c26897fa9f420))
* remove slash command component and integrate slash command functionality ([#281](https://github.com/Auxx-Ai/auxx-ai/issues/281)) ([07edcfa](https://github.com/Auxx-Ai/auxx-ai/commit/07edcfafb41a1578dc6af5a9c5f79eb1d3104adb))
* remove system Pulumi to avoid version conflict with SST ([56dee33](https://github.com/Auxx-Ai/auxx-ai/commit/56dee33dbea954df7d9bf449e4b09c69d041fb86))
* remove unused db models ([#88](https://github.com/Auxx-Ai/auxx-ai/issues/88)) ([7a6bc8e](https://github.com/Auxx-Ai/auxx-ai/commit/7a6bc8eee72dcd76b839eb265d069e4992c40af1))
* removed db models ([#90](https://github.com/Auxx-Ai/auxx-ai/issues/90)) ([cb5399b](https://github.com/Auxx-Ai/auxx-ai/commit/cb5399b2225eace27c758ee5ba4f6a4c54e45cf3))
* rename  integration to channels ([#214](https://github.com/Auxx-Ai/auxx-ai/issues/214)) ([975db36](https://github.com/Auxx-Ai/auxx-ai/commit/975db362c2ee222e8a0f3807aa6b729a68207993))
* renaming integration to channel and improve store/hooks,etc ([#245](https://github.com/Auxx-Ai/auxx-ai/issues/245)) ([ec1091d](https://github.com/Auxx-Ai/auxx-ai/commit/ec1091db8aa466d86c30ef025926496550dbd2dd))
* replace CustomFieldValue with FieldValue across the codebase ([#203](https://github.com/Auxx-Ai/auxx-ai/issues/203)) ([35a010c](https://github.com/Auxx-Ai/auxx-ai/commit/35a010c6977a33ba2c1f42c539f66cfa1cbae477))
* replace scroll-area-v2 with scroll-area component across the application ([#329](https://github.com/Auxx-Ai/auxx-ai/issues/329)) ([5d04328](https://github.com/Auxx-Ai/auxx-ai/commit/5d0432828f24c449c2ae44ef3c95e8c766ea0d1c))
* resource fetching and caching mechanisms ([#274](https://github.com/Auxx-Ai/auxx-ai/issues/274)) ([4cc4f60](https://github.com/Auxx-Ai/auxx-ai/commit/4cc4f6004dd7d40c24f1947da132d9f9249ed1aa))
* resource key unification ([#309](https://github.com/Auxx-Ai/auxx-ai/issues/309)) ([79a5114](https://github.com/Auxx-Ai/auxx-ai/commit/79a51146445cf9b4e732a360e0860c160ef2dad1))
* **resource-access:** implement resource access management ([56ded83](https://github.com/Auxx-Ai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))
* **search:** implement global search functionality with full-text support and pagination ([a77c8ef](https://github.com/Auxx-Ai/auxx-ai/commit/a77c8ef51e31ff3cce673109fef02bc4f2dc50b7))
* **search:** implement new search store and selectors for mail search functionality ([720eaf2](https://github.com/Auxx-Ai/auxx-ai/commit/720eaf219b8bd4fc9194e0ae515e663859031c21))
* **search:** refactor search store to use conditions instead of filters ([efda864](https://github.com/Auxx-Ai/auxx-ai/commit/efda8647b5a57c517064ec6ba9ddebb59d4f3f6b))
* **signatures:** add signature management components and API integration ([731c4e2](https://github.com/Auxx-Ai/auxx-ai/commit/731c4e2034ae33dd8bf134873c6a61577aa7bfea))
* simplify inbound email bucket policy by integrating it directly into the bucket definition ([#232](https://github.com/Auxx-Ai/auxx-ai/issues/232)) ([d68713a](https://github.com/Auxx-Ai/auxx-ai/commit/d68713a18fa5f4720148513c35faa027d8482a03))
* specify exact Deno version in deployment workflow ([c583bc5](https://github.com/Auxx-Ai/auxx-ai/commit/c583bc5a923a7ed9ba183128c36aa86d2e42510d))
* specify platform for services in Docker Compose ([#116](https://github.com/Auxx-Ai/auxx-ai/issues/116)) ([4cc3c32](https://github.com/Auxx-Ai/auxx-ai/commit/4cc3c324130076be738771f28e99a4da5d9493ef))
* streamline database migration process and remove obsolete scripts ([#79](https://github.com/Auxx-Ai/auxx-ai/issues/79)) ([fb58833](https://github.com/Auxx-Ai/auxx-ai/commit/fb588333bac9dc9217059b0af28c4e17c1297fc6))
* streamline workflow components and enhance caching mechanisms ([#314](https://github.com/Auxx-Ai/auxx-ai/issues/314)) ([2e97f2b](https://github.com/Auxx-Ai/auxx-ai/commit/2e97f2b5dce9b3682ae394f4d0d2ae907ffd4638))
* switch npm commands to pnpm for package verification and publis… ([#125](https://github.com/Auxx-Ai/auxx-ai/issues/125)) ([8462cd8](https://github.com/Auxx-Ai/auxx-ai/commit/8462cd817f2d8749859e3a3aa120b65d1756cad2))
* **task:** add task management types and utilities ([4de361a](https://github.com/Auxx-Ai/auxx-ai/commit/4de361a87051a2210c9d4733d6251c7f15714dcc))
* **tests:** update variable validation and workflow graph tests for … ([#34](https://github.com/Auxx-Ai/auxx-ai/issues/34)) ([71b86f6](https://github.com/Auxx-Ai/auxx-ai/commit/71b86f69d5a7862fbf48f749fe1307dff5141f4a))
* **ui:** enhance emoji picker exports and add emoji utilities ([c8a9f1e](https://github.com/Auxx-Ai/auxx-ai/commit/c8a9f1ecb3f48739060565d9289441d16dcc5210))
* unify application URL management and env variable config ([#77](https://github.com/Auxx-Ai/auxx-ai/issues/77)) ([39660ef](https://github.com/Auxx-Ai/auxx-ai/commit/39660ef2b922054272beab21211356f2886148a2))
* unify Lambda URL configuration ([#159](https://github.com/Auxx-Ai/auxx-ai/issues/159)) ([b1eaad5](https://github.com/Auxx-Ai/auxx-ai/commit/b1eaad59f3e287fc2f0463143410aee3f17b3167))
* unique const for apiSlug in def, kanban color, default model ai for workflow ([#254](https://github.com/Auxx-Ai/auxx-ai/issues/254)) ([31217d9](https://github.com/Auxx-Ai/auxx-ai/commit/31217d95f8afe6be0a59fe7b0dee0d56c169bed2))
* update  textarea comp for impr. dark mode support and styling consistency ([#298](https://github.com/Auxx-Ai/auxx-ai/issues/298)) ([cedbc30](https://github.com/Auxx-Ai/auxx-ai/commit/cedbc30a148dc8b2364fa183852faf3e201e14bc))
* update API routes for SDK webhooks and settings ([#170](https://github.com/Auxx-Ai/auxx-ai/issues/170)) ([1d502c8](https://github.com/Auxx-Ai/auxx-ai/commit/1d502c80ba907a0597919699e1f8113c522d4641))
* update app icon display and enhance screenshot handling in app … ([#157](https://github.com/Auxx-Ai/auxx-ai/issues/157)) ([c6fda72](https://github.com/Auxx-Ai/auxx-ai/commit/c6fda721ba3264e58f390844d56665b87bdb131d))
* update AWS provider configuration to conditionally include profile based on GITHUB_ACTIONS ([b0769bb](https://github.com/Auxx-Ai/auxx-ai/commit/b0769bbe665d6f90392b22c0ac1955e640490a23))
* update AWS resource ([bf193d1](https://github.com/Auxx-Ai/auxx-ai/commit/bf193d14d6b75d584cebd0c4fb4d42a463ca01ba))
* update billing and subscription handling; integrate plan downgrade logic ([#266](https://github.com/Auxx-Ai/auxx-ai/issues/266)) ([e1caae5](https://github.com/Auxx-Ai/auxx-ai/commit/e1caae5feb8208981f4fa323910b0f7d1d096fa1))
* update color defaults and add new configuration options ([#9](https://github.com/Auxx-Ai/auxx-ai/issues/9)) ([22b0e83](https://github.com/Auxx-Ai/auxx-ai/commit/22b0e834737a9fb06a3eed3b2041d5cef39e0435))
* update default visibility for custom fields in dynamic table to false ([8d829b1](https://github.com/Auxx-Ai/auxx-ai/commit/8d829b1827d6824183ca89c72577e145b31063a1))
* update demo login button and enhance demo page step progression ([#304](https://github.com/Auxx-Ai/auxx-ai/issues/304)) ([13e7299](https://github.com/Auxx-Ai/auxx-ai/commit/13e7299f322ab2eb824e0e1c94561aa083e553bf))
* update documentation structure and add troubleshooting guides ([#204](https://github.com/Auxx-Ai/auxx-ai/issues/204)) ([3499fc8](https://github.com/Auxx-Ai/auxx-ai/commit/3499fc8c91cb1f830dd526e5ebf2b510cfd892ad))
* update entity definition handling to use ref for color management ([#256](https://github.com/Auxx-Ai/auxx-ai/issues/256)) ([3c57f64](https://github.com/Auxx-Ai/auxx-ai/commit/3c57f64c2008d2601126146ee4131641b4f329d8))
* update feature limits for free plan and premium plan; add screenshots to README ([#261](https://github.com/Auxx-Ai/auxx-ai/issues/261)) ([7cbeb64](https://github.com/Auxx-Ai/auxx-ai/commit/7cbeb645e0aabb15fd61242e07a765107a367947))
* update imports and exports across packages for consistency ([#85](https://github.com/Auxx-Ai/auxx-ai/issues/85)) ([41d4058](https://github.com/Auxx-Ai/auxx-ai/commit/41d40583c7e3b2d2742cd12297235fe631988439))
* update imports and types across various modules ([e9bdde7](https://github.com/Auxx-Ai/auxx-ai/commit/e9bdde704d038a02e62dcba837cbe8160f006980))
* update inbound email bucket policy and enhance app connection details ([#231](https://github.com/Auxx-Ai/auxx-ai/issues/231)) ([bff1082](https://github.com/Auxx-Ai/auxx-ai/commit/bff1082d6b99be7a016a99042e45b7d74128870e))
* update InlinePickerPopover to use Radix Popover for positioning and remove deprecated containerRef prop ([76c6e05](https://github.com/Auxx-Ai/auxx-ai/commit/76c6e0518d370a0e73face26bc02735cf0c38e7b))
* update Instagram and OpenPhone logos with new designs and gradients ([#307](https://github.com/Auxx-Ai/auxx-ai/issues/307)) ([bcb728b](https://github.com/Auxx-Ai/auxx-ai/commit/bcb728b0e6586cca820ca6a9c156c41f5f278f17))
* update layout and metadata for Auxx.ai documentation ([#199](https://github.com/Auxx-Ai/auxx-ai/issues/199)) ([1a8720f](https://github.com/Auxx-Ai/auxx-ai/commit/1a8720fd0674dc058f58ceac8a368fa4b90c1d72))
* update Next.js configuration and package exports ([#169](https://github.com/Auxx-Ai/auxx-ai/issues/169)) ([098fe41](https://github.com/Auxx-Ai/auxx-ai/commit/098fe4160596142c38dad22e10a355e9a9cb7e04))
* update notification center to include unread count query ([ef54a69](https://github.com/Auxx-Ai/auxx-ai/commit/ef54a690a07300d6d236cb08ab9fc9ccfd3a0308))
* update notification center to include unread count query ([0104b0a](https://github.com/Auxx-Ai/auxx-ai/commit/0104b0a99358e66b8731112e006f2d4c9d00914d))
* update Redis instance name to AuxxAiRedisV3 ([#96](https://github.com/Auxx-Ai/auxx-ai/issues/96)) ([1e3aa1b](https://github.com/Auxx-Ai/auxx-ai/commit/1e3aa1b5bed5378369e74ecd47f40c55d9e3bab7))
* update resource handling to use entityDefinitionId instead of tableId across components and services ([17bcea4](https://github.com/Auxx-Ai/auxx-ai/commit/17bcea4fb34fc650a0a67ec414530947d9acef90))
* update resource instantiation to remove version suffix ([7a32d39](https://github.com/Auxx-Ai/auxx-ai/commit/7a32d399dbac58e2838b7529b2580b580699e32a))
* update SST configuration to include database deployment function name ([97713c0](https://github.com/Auxx-Ai/auxx-ai/commit/97713c0eee792f245315ed7e4243f27e4943c530))
* update storeMessage method to return message ID and new insert status ([#249](https://github.com/Auxx-Ai/auxx-ai/issues/249)) ([55d44e4](https://github.com/Auxx-Ai/auxx-ai/commit/55d44e40c3e6b61e37bf3fde02a5f576c2aed1dd))
* update Stripe client initialization to use console warning instead of throwing an error ([04696d5](https://github.com/Auxx-Ai/auxx-ai/commit/04696d5654b29d62ae5b29dfa33120f4400a4bb7))
* update text classifier to support variable output mode and enhance app connections ([#293](https://github.com/Auxx-Ai/auxx-ai/issues/293)) ([5494123](https://github.com/Auxx-Ai/auxx-ai/commit/549412322399bbf313cb765dc43e42a037af4e3a))
* update VPC instantiation to remove version suffix ([cfc50d3](https://github.com/Auxx-Ai/auxx-ai/commit/cfc50d3b85046c1c6cbaa076d376318772aa3007))
* update workflow vars in apps ([#313](https://github.com/Auxx-Ai/auxx-ai/issues/313)) ([11de09f](https://github.com/Auxx-Ai/auxx-ai/commit/11de09f6f2c67c27c3dd0b5d5e326ff16bd92dfa))
* upgrade nodemailer and AWS SDK dependencies; refactor SES trans… ([#143](https://github.com/Auxx-Ai/auxx-ai/issues/143)) ([45441b8](https://github.com/Auxx-Ai/auxx-ai/commit/45441b822306f574d7cf302a0d482055bbb54faa))
* **var-editor:** update border styling for field row variants ([368e0ff](https://github.com/Auxx-Ai/auxx-ai/commit/368e0ff1e9a0ec1d7edb317b79c293f1914803f2))
* variableTag component to allow array ([4bd196e](https://github.com/Auxx-Ai/auxx-ai/commit/4bd196e7468eee433f9e509308d2e8ba38e10af2))
* **workflow:** update approval query service to use new group membership model ([56ded83](https://github.com/Auxx-Ai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))


### Bug Fixes

* add ActorInput component and integrate into workflow nodes ([#11](https://github.com/Auxx-Ai/auxx-ai/issues/11)) ([d0b3f49](https://github.com/Auxx-Ai/auxx-ai/commit/d0b3f498ab4e883cd44e8a48e70645ab2f0eb825))
* add SES permissions to IAM policy for SST deploys ([#218](https://github.com/Auxx-Ai/auxx-ai/issues/218)) ([653655d](https://github.com/Auxx-Ai/auxx-ai/commit/653655d965c3cadf081d3971a85e6e56a29bf764))
* clean up CI workflows and Dockerfiles ([#28](https://github.com/Auxx-Ai/auxx-ai/issues/28)) ([a8cf34c](https://github.com/Auxx-Ai/auxx-ai/commit/a8cf34cf2a056d9cbcd7ff203a323db890c91fe7))
* clean up variable utilities and remove deprecated functions ([3f4b99f](https://github.com/Auxx-Ai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* contacts and vendor parts services ([#15](https://github.com/Auxx-Ai/auxx-ai/issues/15)) ([7c20cee](https://github.com/Auxx-Ai/auxx-ai/commit/7c20cee2a8ccbafc5e9868a4e26b7917a631cb24))
* correct redirectURLs to redirectUrls in auth configuration ([#133](https://github.com/Auxx-Ai/auxx-ai/issues/133)) ([d7aebd4](https://github.com/Auxx-Ai/auxx-ai/commit/d7aebd4db501a5ab537ecfadf755db163e1d7453))
* enhance SST deploy and unlock workflows with additional input pa… ([#66](https://github.com/Auxx-Ai/auxx-ai/issues/66)) ([b533cb6](https://github.com/Auxx-Ai/auxx-ai/commit/b533cb62ae9ce5bb0c74219e02c3689fdf709d8a))
* optimize CI workflow by adding disk space cleanup and refining c… ([#29](https://github.com/Auxx-Ai/auxx-ai/issues/29)) ([fa2ad96](https://github.com/Auxx-Ai/auxx-ai/commit/fa2ad962267a30f50589f526859dd506ffdbe7e4))
* optimize unread service to directly filter by inboxId ([f094994](https://github.com/Auxx-Ai/auxx-ai/commit/f094994c83d4fe6e300002e1875a439034b6f6eb))
* refine conditional logic for Docker image workflow steps ([#19](https://github.com/Auxx-Ai/auxx-ai/issues/19)) ([6c00005](https://github.com/Auxx-Ai/auxx-ai/commit/6c000054ee7237e965bfa85d5c73640e4f8da485))
* remove deprecated @t3-oss/env-nextjs package references and clea… ([#83](https://github.com/Auxx-Ai/auxx-ai/issues/83)) ([7452829](https://github.com/Auxx-Ai/auxx-ai/commit/7452829610ecb19ffe8ea8f8ab574f4ab97bdeb6))
* remove unnecessary class from AppListCard component ([#150](https://github.com/Auxx-Ai/auxx-ai/issues/150)) ([4dba483](https://github.com/Auxx-Ai/auxx-ai/commit/4dba483c1598342ffa6f658cf43c4324add9718a))
* rename PORT to API_PORT for clarity and update related configura… ([#54](https://github.com/Auxx-Ai/auxx-ai/issues/54)) ([cc4e79a](https://github.com/Auxx-Ai/auxx-ai/commit/cc4e79aab46a00b0f3862962dcff688013a2d54b))
* replace 'import type React' with 'import React' in email components ([#224](https://github.com/Auxx-Ai/auxx-ai/issues/224)) ([2493d31](https://github.com/Auxx-Ai/auxx-ai/commit/2493d311513032d68a5d1e898e68a11cb6970eb5))
* resolve circular dependency in ConfigService ([#102](https://github.com/Auxx-Ai/auxx-ai/issues/102)) ([5082432](https://github.com/Auxx-Ai/auxx-ai/commit/50824325f26e273da9911c28c64a2e739072f66e))
* resolve useExhaustiveDependencies lint warnings across codebase ([#6](https://github.com/Auxx-Ai/auxx-ai/issues/6)) ([96fa3d9](https://github.com/Auxx-Ai/auxx-ai/commit/96fa3d9fdab47689a956dce0b3e5e4b1e44415eb))
* streamline variable explorer by removing unnecessary imports ([3f4b99f](https://github.com/Auxx-Ai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* update CI permissions to include pull-requests read access ([#52](https://github.com/Auxx-Ai/auxx-ai/issues/52)) ([7f5231d](https://github.com/Auxx-Ai/auxx-ai/commit/7f5231da5adb6d0beb8166f814e2f4e3ca42b792))
* update CORS configuration to support extra origins and improve m… ([#55](https://github.com/Auxx-Ai/auxx-ai/issues/55)) ([c442c95](https://github.com/Auxx-Ai/auxx-ai/commit/c442c959d0dd45304e8b1fd6c0168a63b9227297))
* update dependencies and adjust import paths for noble hashes ([#53](https://github.com/Auxx-Ai/auxx-ai/issues/53)) ([fcff17b](https://github.com/Auxx-Ai/auxx-ai/commit/fcff17b869b552d035e3237bfc33256f5289f055))
* update Dockerfiles and entrypoint for improved builds and runtim… ([#20](https://github.com/Auxx-Ai/auxx-ai/issues/20)) ([68d3c6c](https://github.com/Auxx-Ai/auxx-ai/commit/68d3c6c3cf5d20fbfd51e93b80490d3af7c43e35))
* update Dockerfiles to increase memory limit and improve pnpm dep… ([#86](https://github.com/Auxx-Ai/auxx-ai/issues/86)) ([d07af68](https://github.com/Auxx-Ai/auxx-ai/commit/d07af68a1ee488f435bbb3c39a76244da29c565a))
* update Dockerfiles to refine build filters for SDK and web compo… ([#27](https://github.com/Auxx-Ai/auxx-ai/issues/27)) ([b17a862](https://github.com/Auxx-Ai/auxx-ai/commit/b17a862d7f21794ba4726b8c5b3870eeb82a949b))
* update Dockerfiles to use consistent base image and improve depe… ([#22](https://github.com/Auxx-Ai/auxx-ai/issues/22)) ([accaaff](https://github.com/Auxx-Ai/auxx-ai/commit/accaaff28769dfa352850800ffbcc10576ce6174))
* update entity fields component to use custom field mutations and improve field handling ([3f4b99f](https://github.com/Auxx-Ai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* update entity instance operations to use custom field mutations ([3f4b99f](https://github.com/Auxx-Ai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* update ownership in Dockerfiles and enhance URL trust validation ([#81](https://github.com/Auxx-Ai/auxx-ai/issues/81)) ([78cc8a1](https://github.com/Auxx-Ai/auxx-ai/commit/78cc8a1bc5f7282c2417d71aa385f49d0bb1afd7))
* update PartsContent to use resourceId instead of partId for drawer ([8d829b1](https://github.com/Auxx-Ai/auxx-ai/commit/8d829b1827d6824183ca89c72577e145b31063a1))
* update platform script reference and enhance Dockerfile for runt… ([#182](https://github.com/Auxx-Ai/auxx-ai/issues/182)) ([ca42a2f](https://github.com/Auxx-Ai/auxx-ai/commit/ca42a2fb7d6a7f0d61a6f639ff7bc59d2c6e8cbd))
* update SES inbound region handling and enhance S3 bucket policies ([#220](https://github.com/Auxx-Ai/auxx-ai/issues/220)) ([d045a5a](https://github.com/Auxx-Ai/auxx-ai/commit/d045a5add57b17697d186b13d2d74f4b29834252))
* update test suite for workflow engine and error handling ([#50](https://github.com/Auxx-Ai/auxx-ai/issues/50)) ([32b8f71](https://github.com/Auxx-Ai/auxx-ai/commit/32b8f71abfe4c07d37a95f1789f7b4a5a03ce097))
* update variable types to use relatedEntityDefinitionId for better clarity ([8d829b1](https://github.com/Auxx-Ai/auxx-ai/commit/8d829b1827d6824183ca89c72577e145b31063a1))

## [0.1.108](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.107...auxx-v0.1.108) (2026-03-29)


### Features

* enhance ManualTriggerProcessor to support file input handling and streamline variable setting ([#349](https://github.com/Auxx-Ai/auxx-ai/issues/349)) ([814f940](https://github.com/Auxx-Ai/auxx-ai/commit/814f940963d1dcc9d6ed99deab13ea285baa825a))

## [0.1.107](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.106...auxx-v0.1.107) (2026-03-28)


### Features

* add array accessor handling and context menu updates for variable selection ([#345](https://github.com/Auxx-Ai/auxx-ai/issues/345)) ([aecdaee](https://github.com/Auxx-Ai/auxx-ai/commit/aecdaee6f67f11d4963516fc0e431ee77eb5b74b))
* add FormatProcessor for various text and number formatting operations ([#347](https://github.com/Auxx-Ai/auxx-ai/issues/347)) ([4391859](https://github.com/Auxx-Ai/auxx-ai/commit/439185972bef6516e9c2428950a8ad9b47b9b4fe))
* enhance AIProcessorV2 to support file attachments and improve file handling ([#348](https://github.com/Auxx-Ai/auxx-ai/issues/348)) ([b35dbb1](https://github.com/Auxx-Ai/auxx-ai/commit/b35dbb12cd017b668b182588d4f95de448591d19))

## [0.1.106](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.105...auxx-v0.1.106) (2026-03-27)


### Features

* implement CDN video URL handling and block demo users from accessing developer portal ([#343](https://github.com/Auxx-Ai/auxx-ai/issues/343)) ([45f0045](https://github.com/Auxx-Ai/auxx-ai/commit/45f0045747e490ceb47bceeae046a1528283fb54))

## [0.1.105](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.104...auxx-v0.1.105) (2026-03-27)


### Features

* enhance workflow components with improved event handling and UI updates ([#341](https://github.com/Auxx-Ai/auxx-ai/issues/341)) ([90c5748](https://github.com/Auxx-Ai/auxx-ai/commit/90c5748674d2c0b5600ecf2a1b03c9851abcacb7))
* variableTag component to allow array ([4bd196e](https://github.com/Auxx-Ai/auxx-ai/commit/4bd196e7468eee433f9e509308d2e8ba38e10af2))

## [0.1.104](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.103...auxx-v0.1.104) (2026-03-26)


### Features

* add public approval page with token-based and authenticated flows ([#338](https://github.com/Auxx-Ai/auxx-ai/issues/338)) ([3067e1d](https://github.com/Auxx-Ai/auxx-ai/commit/3067e1d19d1ef012f3a837ba34419998c01422f1))
* add scheduled message functionality ([#339](https://github.com/Auxx-Ai/auxx-ai/issues/339)) ([f18dfe7](https://github.com/Auxx-Ai/auxx-ai/commit/f18dfe7bcf514764ee3b60b9722c1cb5df33f7f9))
* add scheduled message functionality with enqueue and send jobs ([#336](https://github.com/Auxx-Ai/auxx-ai/issues/336)) ([7c5e58f](https://github.com/Auxx-Ai/auxx-ai/commit/7c5e58fc25631248a9a49f6d6a9dbdf568a860f4))
* implement AutoplayVideo component and replace video tags across multiple sections ([#340](https://github.com/Auxx-Ai/auxx-ai/issues/340)) ([9efd0d1](https://github.com/Auxx-Ai/auxx-ai/commit/9efd0d18d037c938e90b6b3b0e015e13b3adff22))

## [0.1.103](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.102...auxx-v0.1.103) (2026-03-26)


### Features

* enhance template transform with default assignees for human-confirmation nodes ([#334](https://github.com/Auxx-Ai/auxx-ai/issues/334)) ([a2e58ba](https://github.com/Auxx-Ai/auxx-ai/commit/a2e58ba0c4f47b0fb848b3354c715cfe7e4d9c7f))

## [0.1.102](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.101...auxx-v0.1.102) (2026-03-25)


### Features

* add new signup videos and update onboarding pages with video backgrounds ([#332](https://github.com/Auxx-Ai/auxx-ai/issues/332)) ([a2d07a9](https://github.com/Auxx-Ai/auxx-ai/commit/a2d07a95da32988345ecded0218d95d0101a5a2a))

## [0.1.101](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.100...auxx-v0.1.101) (2026-03-25)


### Features

* add resolvers for system relationships and virtual fields ([#331](https://github.com/Auxx-Ai/auxx-ai/issues/331)) ([9efa52f](https://github.com/Auxx-Ai/auxx-ai/commit/9efa52ff96a5540f582f84fe65a43d696c73bee0))
* enhance system condition builder and UI components ([#327](https://github.com/Auxx-Ai/auxx-ai/issues/327)) ([3f2937d](https://github.com/Auxx-Ai/auxx-ai/commit/3f2937d43fc4884f819558b3a77c08fb677f9ac0))
* enhance UI components and improve accessibility ([#330](https://github.com/Auxx-Ai/auxx-ai/issues/330)) ([980b595](https://github.com/Auxx-Ai/auxx-ai/commit/980b595936711d9d29ed68ae2811e4af9cd63e00))
* replace scroll-area-v2 with scroll-area component across the application ([#329](https://github.com/Auxx-Ai/auxx-ai/issues/329)) ([5d04328](https://github.com/Auxx-Ai/auxx-ai/commit/5d0432828f24c449c2ae44ef3c95e8c766ea0d1c))

## [0.1.100](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.99...auxx-v0.1.100) (2026-03-24)


### Features

* add batch hydration for field values and enhance logging capabilities in workflow execution ([#325](https://github.com/Auxx-Ai/auxx-ai/issues/325)) ([cf00828](https://github.com/Auxx-Ai/auxx-ai/commit/cf0082878b450100ff95105dc68f52298957442d))
* enhance condition item and input components to support metadata in value change callbacks ([#324](https://github.com/Auxx-Ai/auxx-ai/issues/324)) ([9892211](https://github.com/Auxx-Ai/auxx-ai/commit/98922110d4efdf067f12b2e5e54eb6a539a914fd))
* implement meteors component and enhance layout responsiveness in mail section ([#322](https://github.com/Auxx-Ai/auxx-ai/issues/322)) ([538efb5](https://github.com/Auxx-Ai/auxx-ai/commit/538efb5d1efa38914a57122f4592145ff2ce0074))
* implement record field caching and lazy loading for improved performance ([#326](https://github.com/Auxx-Ai/auxx-ai/issues/326)) ([f4ffc2a](https://github.com/Auxx-Ai/auxx-ai/commit/f4ffc2aba387a31a36e1f7bec98c06a2743d53f8))

## [0.1.99](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.98...auxx-v0.1.99) (2026-03-23)


### Features

* add translucent variant to AvatarUpload, BillingCycleToggle, HorizontalPlanCard, PlanCard ([#317](https://github.com/Auxx-Ai/auxx-ai/issues/317)) ([912abc5](https://github.com/Auxx-Ai/auxx-ai/commit/912abc5319bc9c47a9e1abee3889f8490a9561e1))
* enhance compose editor with pop-out, minimize, and dock-back functionality ([#320](https://github.com/Auxx-Ai/auxx-ai/issues/320)) ([0c5d2a5](https://github.com/Auxx-Ai/auxx-ai/commit/0c5d2a57fc89dba1790ea078e2c5046f2f9428da))
* integrate mail filter context into search bar to conditionally display scope badge ([#319](https://github.com/Auxx-Ai/auxx-ai/issues/319)) ([99e8b35](https://github.com/Auxx-Ai/auxx-ai/commit/99e8b35e581230c0def9148521aa2b809167d160))
* integrate react-hotkeys for keyboard shortcuts in workflow and threads ([fffbc25](https://github.com/Auxx-Ai/auxx-ai/commit/fffbc252d62f7178927e6a61d5a7b18f8a258cf9))

## [0.1.98](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.97...auxx-v0.1.98) (2026-03-21)


### Features

* enhance message handling with replyAll option and auto-resolve features ([#315](https://github.com/Auxx-Ai/auxx-ai/issues/315)) ([15fd30e](https://github.com/Auxx-Ai/auxx-ai/commit/15fd30e1e586826b0558b377e8f48ef87abd3e51))
* enhance UI components with keyboard shortcuts and collapsible sections ([55fb1e8](https://github.com/Auxx-Ai/auxx-ai/commit/55fb1e8b713582166351c6a2a7e258137c2fa520))

## [0.1.97](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.96...auxx-v0.1.97) (2026-03-21)


### Features

* enhance date handling and ticket integration ([#311](https://github.com/Auxx-Ai/auxx-ai/issues/311)) ([3d67285](https://github.com/Auxx-Ai/auxx-ai/commit/3d6728530204b186fcac7498270fbac0604868e1))
* fix conditions ([#312](https://github.com/Auxx-Ai/auxx-ai/issues/312)) ([763be20](https://github.com/Auxx-Ai/auxx-ai/commit/763be2028b4eabaeaa2cda664b7232b6d7d3d528))
* resource key unification ([#309](https://github.com/Auxx-Ai/auxx-ai/issues/309)) ([79a5114](https://github.com/Auxx-Ai/auxx-ai/commit/79a51146445cf9b4e732a360e0860c160ef2dad1))
* streamline workflow components and enhance caching mechanisms ([#314](https://github.com/Auxx-Ai/auxx-ai/issues/314)) ([2e97f2b](https://github.com/Auxx-Ai/auxx-ai/commit/2e97f2b5dce9b3682ae394f4d0d2ae907ffd4638))
* update workflow vars in apps ([#313](https://github.com/Auxx-Ai/auxx-ai/issues/313)) ([11de09f](https://github.com/Auxx-Ai/auxx-ai/commit/11de09f6f2c67c27c3dd0b5d5e326ff16bd92dfa))

## [0.1.96](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.95...auxx-v0.1.96) (2026-03-20)


### Features

* update Instagram and OpenPhone logos with new designs and gradients ([#307](https://github.com/Auxx-Ai/auxx-ai/issues/307)) ([bcb728b](https://github.com/Auxx-Ai/auxx-ai/commit/bcb728b0e6586cca820ca6a9c156c41f5f278f17))

## [0.1.95](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.94...auxx-v0.1.95) (2026-03-20)


### Features

* implement inline app install button and enhance extensions context for installation management ([#306](https://github.com/Auxx-Ai/auxx-ai/issues/306)) ([ba2829c](https://github.com/Auxx-Ai/auxx-ai/commit/ba2829c0b6a66fb8ec5d023f07ca675692be7860))
* update demo login button and enhance demo page step progression ([#304](https://github.com/Auxx-Ai/auxx-ai/issues/304)) ([13e7299](https://github.com/Auxx-Ai/auxx-ai/commit/13e7299f322ab2eb824e0e1c94561aa083e553bf))

## [0.1.94](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.93...auxx-v0.1.94) (2026-03-19)


### Features

* integrate demo data seeding and configurations ([#302](https://github.com/Auxx-Ai/auxx-ai/issues/302)) ([e995771](https://github.com/Auxx-Ai/auxx-ai/commit/e99577167ff7b6e69209b5723360cd087d6b9c9f))

## [0.1.93](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.92...auxx-v0.1.93) (2026-03-19)


### Features

* add demo organization features and cleanup jobs ([#301](https://github.com/Auxx-Ai/auxx-ai/issues/301)) ([4cf3929](https://github.com/Auxx-Ai/auxx-ai/commit/4cf3929fe11f241f013e6d8419547b6a80d13995))
* enhance filter builder and find panel with resource field ID handling ([#299](https://github.com/Auxx-Ai/auxx-ai/issues/299)) ([0707884](https://github.com/Auxx-Ai/auxx-ai/commit/07078844601cf6c155f2a4e96d94b82ff7e78751))

## [0.1.92](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.91...auxx-v0.1.92) (2026-03-18)


### Features

* add icon support to workflow templates ([#292](https://github.com/Auxx-Ai/auxx-ai/issues/292)) ([5bfc876](https://github.com/Auxx-Ai/auxx-ai/commit/5bfc8764b6852967fcfa06fd7c7389ea75551dfe))
* add integration tests for billing plan changes and trials ([#288](https://github.com/Auxx-Ai/auxx-ai/issues/288)) ([28c3052](https://github.com/Auxx-Ai/auxx-ai/commit/28c30528a62d40004574a197f7ca05b87d93826d))
* add support for required apps and entities in workflow templates ([#291](https://github.com/Auxx-Ai/auxx-ai/issues/291)) ([80f6f0c](https://github.com/Auxx-Ai/auxx-ai/commit/80f6f0c01771cf9311da83bf5eaf53ea8e49f8da))
* add variable availability and graph computation modules ([#295](https://github.com/Auxx-Ai/auxx-ai/issues/295)) ([17cc47a](https://github.com/Auxx-Ai/auxx-ai/commit/17cc47aefc3846dcf0f59104390257ce11a2b43d))
* app cache providers and implement new app slug and published apps providers ([#290](https://github.com/Auxx-Ai/auxx-ai/issues/290)) ([8e968bd](https://github.com/Auxx-Ai/auxx-ai/commit/8e968bd9a51b3d9fa7b49a97befccd88e34407ea))
* enhance  entityDefinitionId support and improving var label resolution in workflow ([#296](https://github.com/Auxx-Ai/auxx-ai/issues/296)) ([c9e50d5](https://github.com/Auxx-Ai/auxx-ai/commit/c9e50d56c432a6cf94f9f7406ebc3ab770c1439c))
* implement org-level config management for Google and Outlook integrations ([#294](https://github.com/Auxx-Ai/auxx-ai/issues/294)) ([b40b2bc](https://github.com/Auxx-Ai/auxx-ai/commit/b40b2bc96a8e055c27c228aa7a212ab50c222a3d))
* refactor variable editor array component for improved usability and performance ([#297](https://github.com/Auxx-Ai/auxx-ai/issues/297)) ([1f32e1d](https://github.com/Auxx-Ai/auxx-ai/commit/1f32e1d3be7250116d61cecad32ce35e6f2319a1))
* update  textarea comp for impr. dark mode support and styling consistency ([#298](https://github.com/Auxx-Ai/auxx-ai/issues/298)) ([cedbc30](https://github.com/Auxx-Ai/auxx-ai/commit/cedbc30a148dc8b2364fa183852faf3e201e14bc))
* update text classifier to support variable output mode and enhance app connections ([#293](https://github.com/Auxx-Ai/auxx-ai/issues/293)) ([5494123](https://github.com/Auxx-Ai/auxx-ai/commit/549412322399bbf313cb765dc43e42a037af4e3a))

## [0.1.91](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.90...auxx-v0.1.91) (2026-03-17)


### Features

* implement country selection component and integrate into forms ([#285](https://github.com/Auxx-Ai/auxx-ai/issues/285)) ([e4bbb65](https://github.com/Auxx-Ai/auxx-ai/commit/e4bbb65ff0c7bcf1ffeddec1a0f203c50c902f5d))
* refactor subscription handling and introduce recovery for past_due status ([#287](https://github.com/Auxx-Ai/auxx-ai/issues/287)) ([2857af9](https://github.com/Auxx-Ai/auxx-ai/commit/2857af905483f2fbc3ae518d3ed05f24698183c7))

## [0.1.90](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.89...auxx-v0.1.90) (2026-03-16)


### Features

* add sharp package to serverExternalPackages and update dependencies in pnpm workspace ([#283](https://github.com/Auxx-Ai/auxx-ai/issues/283)) ([b9cebe4](https://github.com/Auxx-Ai/auxx-ai/commit/b9cebe4828db02129d42706ca528def1c0eeea79))

## [0.1.89](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.88...auxx-v0.1.89) (2026-03-16)


### Features

* remove slash command component and integrate slash command functionality ([#281](https://github.com/Auxx-Ai/auxx-ai/issues/281)) ([07edcfa](https://github.com/Auxx-Ai/auxx-ai/commit/07edcfafb41a1578dc6af5a9c5f79eb1d3104adb))

## [0.1.88](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.87...auxx-v0.1.88) (2026-03-16)


### Features

* enhance cache invalidation and workflow limits ([#279](https://github.com/Auxx-Ai/auxx-ai/issues/279)) ([f0e424f](https://github.com/Auxx-Ai/auxx-ai/commit/f0e424f26053f7d4d54421e345ba7de7f9802c73))

## [0.1.87](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.86...auxx-v0.1.87) (2026-03-16)


### Features

* add installed apps and workflow apps providers to cache ([#275](https://github.com/Auxx-Ai/auxx-ai/issues/275)) ([f6a8573](https://github.com/Auxx-Ai/auxx-ai/commit/f6a8573dcdf01c330fe84765490cf7bf4d2a38be))

## [0.1.86](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.85...auxx-v0.1.86) (2026-03-16)


### Features

* cache permissions and member queries to utilize organization cache ([#272](https://github.com/Auxx-Ai/auxx-ai/issues/272)) ([cd56921](https://github.com/Auxx-Ai/auxx-ai/commit/cd56921546e55f19bfbac6597fb065c76fc81656))
* implement app-wide caching for plans and workflow templates ([#273](https://github.com/Auxx-Ai/auxx-ai/issues/273)) ([9a874c5](https://github.com/Auxx-Ai/auxx-ai/commit/9a874c575b07f60669bedafb712fdff3eb8bbb30))
* refactor inbox retrieval methods to use listAll and improve transformation logic ([#270](https://github.com/Auxx-Ai/auxx-ai/issues/270)) ([1895a80](https://github.com/Auxx-Ai/auxx-ai/commit/1895a800041de9610d16ecd13e9d7e65fc2aa8f0))
* resource fetching and caching mechanisms ([#274](https://github.com/Auxx-Ai/auxx-ai/issues/274)) ([4cc4f60](https://github.com/Auxx-Ai/auxx-ai/commit/4cc4f6004dd7d40c24f1947da132d9f9249ed1aa))

## [0.1.85](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.84...auxx-v0.1.85) (2026-03-15)


### Features

* enhance condition badge and search functionality ([#269](https://github.com/Auxx-Ai/auxx-ai/issues/269)) ([d2a4bf7](https://github.com/Auxx-Ai/auxx-ai/commit/d2a4bf74aee7bf384cf9d2c77f5e8db9e5a7953d))
* enhance mail search functionality; add search scope condition and improve participant display ([#268](https://github.com/Auxx-Ai/auxx-ai/issues/268)) ([a13ea7f](https://github.com/Auxx-Ai/auxx-ai/commit/a13ea7f826b872ff351c9ec19624043f5491f3f3))
* update billing and subscription handling; integrate plan downgrade logic ([#266](https://github.com/Auxx-Ai/auxx-ai/issues/266)) ([e1caae5](https://github.com/Auxx-Ai/auxx-ai/commit/e1caae5feb8208981f4fa323910b0f7d1d096fa1))

## [0.1.84](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.83...auxx-v0.1.84) (2026-03-15)


### Features

* add overage detection and handling for feature limits ([#265](https://github.com/Auxx-Ai/auxx-ai/issues/265)) ([80fbd97](https://github.com/Auxx-Ai/auxx-ai/commit/80fbd974b372f4ce5e8556defcb6d877e970aca5))
* enhance logging and security measures, implement CSRF protection for OAuth flows ([#264](https://github.com/Auxx-Ai/auxx-ai/issues/264)) ([3dec1c7](https://github.com/Auxx-Ai/auxx-ai/commit/3dec1c773d783e28e846ec678303191f6750ac14))
* enhance README and install script; add SVG banner and improve installation process ([#263](https://github.com/Auxx-Ai/auxx-ai/issues/263)) ([bede7cf](https://github.com/Auxx-Ai/auxx-ai/commit/bede7cf4c3391bef48f7776e2739983349b362ba))
* update feature limits for free plan and premium plan; add screenshots to README ([#261](https://github.com/Auxx-Ai/auxx-ai/issues/261)) ([7cbeb64](https://github.com/Auxx-Ai/auxx-ai/commit/7cbeb645e0aabb15fd61242e07a765107a367947))

## [0.1.83](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.82...auxx-v0.1.83) (2026-03-14)


### Features

* add entity templates ([64ec4c7](https://github.com/Auxx-Ai/auxx-ai/commit/64ec4c77f4891db62e0e152e95a10f9d8e767244))
* add EntityPreviewCard component for inline editing of entity fields ([#259](https://github.com/Auxx-Ai/auxx-ai/issues/259)) ([40962c2](https://github.com/Auxx-Ai/auxx-ai/commit/40962c2e671f523e7b7e182bf1541c7a4ba16036))
* add new entity templates for meetings, projects, quality inspections, quotes, referrals ([#260](https://github.com/Auxx-Ai/auxx-ai/issues/260)) ([7ee6e30](https://github.com/Auxx-Ai/auxx-ai/commit/7ee6e302122cae538eea2a4d041305fd77a1d3a3))

## [0.1.82](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.81...auxx-v0.1.82) (2026-03-13)


### Features

* update entity definition handling to use ref for color management ([#256](https://github.com/Auxx-Ai/auxx-ai/issues/256)) ([3c57f64](https://github.com/Auxx-Ai/auxx-ai/commit/3c57f64c2008d2601126146ee4131641b4f329d8))

## [0.1.81](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.80...auxx-v0.1.81) (2026-03-13)


### Features

* add optional name field to user profile update ([#255](https://github.com/Auxx-Ai/auxx-ai/issues/255)) ([4325331](https://github.com/Auxx-Ai/auxx-ai/commit/43253312cbb7165ef33dcb62dc54170a1352adb5))
* implement attachment fetching and inbound content ingestion ([#252](https://github.com/Auxx-Ai/auxx-ai/issues/252)) ([1554fc7](https://github.com/Auxx-Ai/auxx-ai/commit/1554fc7e3f6d3f742caf65372e7ded1f13aeb102))
* unique const for apiSlug in def, kanban color, default model ai for workflow ([#254](https://github.com/Auxx-Ai/auxx-ai/issues/254)) ([31217d9](https://github.com/Auxx-Ai/auxx-ai/commit/31217d95f8afe6be0a59fe7b0dee0d56c169bed2))

## [0.1.80](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.79...auxx-v0.1.80) (2026-03-13)


### Features

* implement usage limits and tracking for AI completions, outbound emails ([#251](https://github.com/Auxx-Ai/auxx-ai/issues/251)) ([4b2f497](https://github.com/Auxx-Ai/auxx-ai/commit/4b2f497183c8a5d5e75fc0c1303ff55771c67233))
* update storeMessage method to return message ID and new insert status ([#249](https://github.com/Auxx-Ai/auxx-ai/issues/249)) ([55d44e4](https://github.com/Auxx-Ai/auxx-ai/commit/55d44e40c3e6b61e37bf3fde02a5f576c2aed1dd))

## [0.1.79](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.78...auxx-v0.1.79) (2026-03-13)


### Features

* enhance polling trigger execution with error handling and workflow run creation ([#247](https://github.com/Auxx-Ai/auxx-ai/issues/247)) ([6fd8b5f](https://github.com/Auxx-Ai/auxx-ai/commit/6fd8b5fab26f98a4604b591fbde2f0395f586c23))

## [0.1.78](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.77...auxx-v0.1.78) (2026-03-13)


### Features

* implement Gmail attachment fetching and inbound content ingestion ([#243](https://github.com/Auxx-Ai/auxx-ai/issues/243)) ([b938238](https://github.com/Auxx-Ai/auxx-ai/commit/b938238a9625ec6b2b1e575a7e911f5ce699b14a))
* implement storage cleanup job for async S3 object deletion and Redis cache clearing ([#246](https://github.com/Auxx-Ai/auxx-ai/issues/246)) ([768da67](https://github.com/Auxx-Ai/auxx-ai/commit/768da6742d0a7c0bc2fc81e4b426ab29362f7eea))
* renaming integration to channel and improve store/hooks,etc ([#245](https://github.com/Auxx-Ai/auxx-ai/issues/245)) ([ec1091d](https://github.com/Auxx-Ai/auxx-ai/commit/ec1091db8aa466d86c30ef025926496550dbd2dd))

## [0.1.77](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.76...auxx-v0.1.77) (2026-03-12)


### Features

* enhance record picker with external search and item selection callbacks ([#240](https://github.com/Auxx-Ai/auxx-ai/issues/240)) ([28bdc55](https://github.com/Auxx-Ai/auxx-ai/commit/28bdc5514ebb7b3ac038165fc56f00b12fa47263))
* enhance user profile management and organization settings ([#242](https://github.com/Auxx-Ai/auxx-ai/issues/242)) ([13b46bd](https://github.com/Auxx-Ai/auxx-ai/commit/13b46bdc570eb82c6a1f6d5facc9d247f590bc4b))
* implement inbound email attachment and body processing services ([#241](https://github.com/Auxx-Ai/auxx-ai/issues/241)) ([09a0cc1](https://github.com/Auxx-Ai/auxx-ai/commit/09a0cc19e0804b4eb0f5d67e3ce6b900f1012502))
* implement inline email attachment handling and processing ([#238](https://github.com/Auxx-Ai/auxx-ai/issues/238)) ([1314b81](https://github.com/Auxx-Ai/auxx-ai/commit/1314b81a7a653c69d668703e477d949fa203c099))

## [0.1.76](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.75...auxx-v0.1.76) (2026-03-12)


### Features

* enhance internal URL handling for Lambda execution and improve dev server binding ([#236](https://github.com/Auxx-Ai/auxx-ai/issues/236)) ([d4c848a](https://github.com/Auxx-Ai/auxx-ai/commit/d4c848a59d67ffa2c54fe972e7cdefbe24265052))

## [0.1.75](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.74...auxx-v0.1.75) (2026-03-12)


### Features

* enhance logging for Lambda invocation and error handling ([#234](https://github.com/Auxx-Ai/auxx-ai/issues/234)) ([56df230](https://github.com/Auxx-Ai/auxx-ai/commit/56df230dc13d79fd41b4751b386207bb44af07fd))

## [0.1.74](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.73...auxx-v0.1.74) (2026-03-11)


### Features

* simplify inbound email bucket policy by integrating it directly into the bucket definition ([#232](https://github.com/Auxx-Ai/auxx-ai/issues/232)) ([d68713a](https://github.com/Auxx-Ai/auxx-ai/commit/d68713a18fa5f4720148513c35faa027d8482a03))

## [0.1.73](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.72...auxx-v0.1.73) (2026-03-11)


### Features

* add verified badge to app schema and related services ([#229](https://github.com/Auxx-Ai/auxx-ai/issues/229)) ([b30face](https://github.com/Auxx-Ai/auxx-ai/commit/b30face4031cfa91aa8f61a70b15c52513586091))
* update inbound email bucket policy and enhance app connection details ([#231](https://github.com/Auxx-Ai/auxx-ai/issues/231)) ([bff1082](https://github.com/Auxx-Ai/auxx-ai/commit/bff1082d6b99be7a016a99042e45b7d74128870e))

## [0.1.72](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.71...auxx-v0.1.72) (2026-03-11)


### Features

* add allowed senders management for forwarding integrations ([#228](https://github.com/Auxx-Ai/auxx-ai/issues/228)) ([3a209f1](https://github.com/Auxx-Ai/auxx-ai/commit/3a209f1517a7fefba2115a7f941f96501edab5dc))
* implement IMAP full sync with windowed UID scanning and checkpo… ([#226](https://github.com/Auxx-Ai/auxx-ai/issues/226)) ([7810390](https://github.com/Auxx-Ai/auxx-ai/commit/7810390489a0fff7d3fea835c1cab63f98b3cedd))

## [0.1.71](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.70...auxx-v0.1.71) (2026-03-11)


### Bug Fixes

* replace 'import type React' with 'import React' in email components ([#224](https://github.com/Auxx-Ai/auxx-ai/issues/224)) ([2493d31](https://github.com/Auxx-Ai/auxx-ai/commit/2493d311513032d68a5d1e898e68a11cb6970eb5))

## [0.1.70](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.69...auxx-v0.1.70) (2026-03-11)


### Features

* add connection listing and access control for apps ([#222](https://github.com/Auxx-Ai/auxx-ai/issues/222)) ([dbd883e](https://github.com/Auxx-Ai/auxx-ai/commit/dbd883ea3c78efb7b5341ce0eaad9d11eef0afda))

## [0.1.69](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.68...auxx-v0.1.69) (2026-03-11)


### Bug Fixes

* update SES inbound region handling and enhance S3 bucket policies ([#220](https://github.com/Auxx-Ai/auxx-ai/issues/220)) ([d045a5a](https://github.com/Auxx-Ai/auxx-ai/commit/d045a5add57b17697d186b13d2d74f4b29834252))

## [0.1.68](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.67...auxx-v0.1.68) (2026-03-11)


### Bug Fixes

* add SES permissions to IAM policy for SST deploys ([#218](https://github.com/Auxx-Ai/auxx-ai/issues/218)) ([653655d](https://github.com/Auxx-Ai/auxx-ai/commit/653655d965c3cadf081d3971a85e6e56a29bf764))

## [0.1.67](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.66...auxx-v0.1.67) (2026-03-11)


### Features

* implement inbound email processing pipeline with S3 integration ([#216](https://github.com/Auxx-Ai/auxx-ai/issues/216)) ([b7b7c13](https://github.com/Auxx-Ai/auxx-ai/commit/b7b7c13c1f2074fd994dc41b309b37f72ba477ac))

## [0.1.66](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.65...auxx-v0.1.66) (2026-03-10)


### Features

* rename  integration to channels ([#214](https://github.com/Auxx-Ai/auxx-ai/issues/214)) ([975db36](https://github.com/Auxx-Ai/auxx-ai/commit/975db362c2ee222e8a0f3807aa6b729a68207993))

## [0.1.65](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.64...auxx-v0.1.65) (2026-03-10)


### Features

* add idap email integration ([#211](https://github.com/Auxx-Ai/auxx-ai/issues/211)) ([ed83ef6](https://github.com/Auxx-Ai/auxx-ai/commit/ed83ef6336b9cb3af80d99a3abe7b5eb994d490e))

## [0.1.64](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.63...auxx-v0.1.64) (2026-03-10)


### Features

* enhance developer documentation and add redirect for missing slugs ([#209](https://github.com/Auxx-Ai/auxx-ai/issues/209)) ([67368dc](https://github.com/Auxx-Ai/auxx-ai/commit/67368dc9b18d726540de7d35d38fdd4f8b9b4d59))

## [0.1.63](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.62...auxx-v0.1.63) (2026-03-10)


### Features

* add troubleshooting and workspace documentation ([#207](https://github.com/Auxx-Ai/auxx-ai/issues/207)) ([6494633](https://github.com/Auxx-Ai/auxx-ai/commit/64946331999576fd088161860e68948df0cceefd))
* documentation for dialog API, storage, and various UI components ([#208](https://github.com/Auxx-Ai/auxx-ai/issues/208)) ([e78508d](https://github.com/Auxx-Ai/auxx-ai/commit/e78508ddb49d32ec71653cabd60b5643c361b4f5))
* enhance ticket dashboard and badge components ([#205](https://github.com/Auxx-Ai/auxx-ai/issues/205)) ([16f7dfc](https://github.com/Auxx-Ai/auxx-ai/commit/16f7dfc7687b79f38b461c24b69dc41df0877190))

## [0.1.62](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.61...auxx-v0.1.62) (2026-03-10)


### Features

* docs added dataset, files, tasks ([#202](https://github.com/Auxx-Ai/auxx-ai/issues/202)) ([b1ec3ca](https://github.com/Auxx-Ai/auxx-ai/commit/b1ec3cabd098ebe03c1e6cc30db283949045f86c))
* enhance app access checks and installation queries for improved… ([#201](https://github.com/Auxx-Ai/auxx-ai/issues/201)) ([2e59042](https://github.com/Auxx-Ai/auxx-ai/commit/2e59042b3f0fb8316a851575e64da5bffb2a91d1))
* replace CustomFieldValue with FieldValue across the codebase ([#203](https://github.com/Auxx-Ai/auxx-ai/issues/203)) ([35a010c](https://github.com/Auxx-Ai/auxx-ai/commit/35a010c6977a33ba2c1f42c539f66cfa1cbae477))
* update documentation structure and add troubleshooting guides ([#204](https://github.com/Auxx-Ai/auxx-ai/issues/204)) ([3499fc8](https://github.com/Auxx-Ai/auxx-ai/commit/3499fc8c91cb1f830dd526e5ebf2b510cfd892ad))
* update layout and metadata for Auxx.ai documentation ([#199](https://github.com/Auxx-Ai/auxx-ai/issues/199)) ([1a8720f](https://github.com/Auxx-Ai/auxx-ai/commit/1a8720fd0674dc058f58ceac8a368fa4b90c1d72))

## [0.1.61](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.60...auxx-v0.1.61) (2026-03-09)


### Features

* implement config context and refactor components to use it ([#196](https://github.com/Auxx-Ai/auxx-ai/issues/196)) ([6a6685e](https://github.com/Auxx-Ai/auxx-ai/commit/6a6685e8f597bd45a63ce1aa37ae839f0ddd9e96))

## [0.1.60](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.59...auxx-v0.1.60) (2026-03-09)


### Features

* homepage dark mode, svg components ([#194](https://github.com/Auxx-Ai/auxx-ai/issues/194)) ([dd8bf5f](https://github.com/Auxx-Ai/auxx-ai/commit/dd8bf5ff7cc3b5660124d7fd0e0b91f8a9afdf18))

## [0.1.59](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.58...auxx-v0.1.59) (2026-03-07)


### Features

* enhance S3 client configuration with environment variable suppo… ([#192](https://github.com/Auxx-Ai/auxx-ai/issues/192)) ([d32cfeb](https://github.com/Auxx-Ai/auxx-ai/commit/d32cfeb01f416521d20b279817c2571651522835))

## [0.1.58](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.57...auxx-v0.1.58) (2026-03-07)


### Features

* add dynamic export to auth and public workflow layouts ([#190](https://github.com/Auxx-Ai/auxx-ai/issues/190)) ([b40dd8d](https://github.com/Auxx-Ai/auxx-ai/commit/b40dd8dbb6600bf582a662301c2d16497cc223a9))

## [0.1.57](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.56...auxx-v0.1.57) (2026-03-07)


### Features

* implement orphaned app bundle cleanup job and related scheduling ([#188](https://github.com/Auxx-Ai/auxx-ai/issues/188)) ([d9f16a6](https://github.com/Auxx-Ai/auxx-ai/commit/d9f16a6fb12d3c5e7f78edfbc1dba3717617fc69))

## [0.1.56](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.55...auxx-v0.1.56) (2026-03-07)


### Features

* integrate Cloudflare Turnstile for enhanced security in signup … ([#186](https://github.com/Auxx-Ai/auxx-ai/issues/186)) ([e230559](https://github.com/Auxx-Ai/auxx-ai/commit/e230559b7e55e3e85f013e964be9cf710bb89960))

## [0.1.55](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.54...auxx-v0.1.55) (2026-03-06)


### Features

* add user ban and force password change functionality and build … ([#184](https://github.com/Auxx-Ai/auxx-ai/issues/184)) ([007649c](https://github.com/Auxx-Ai/auxx-ai/commit/007649c7efe629543786f5d002d24a83353f0ac4))

## [0.1.54](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.53...auxx-v0.1.54) (2026-03-06)


### Bug Fixes

* update platform script reference and enhance Dockerfile for runt… ([#182](https://github.com/Auxx-Ai/auxx-ai/issues/182)) ([ca42a2f](https://github.com/Auxx-Ai/auxx-ai/commit/ca42a2fb7d6a7f0d61a6f639ff7bc59d2c6e8cbd))

## [0.1.53](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.52...auxx-v0.1.53) (2026-03-06)


### Features

* implement ArrayInput component with drag-and-drop functionality… ([#180](https://github.com/Auxx-Ai/auxx-ai/issues/180)) ([9fd9de8](https://github.com/Auxx-Ai/auxx-ai/commit/9fd9de8e0df491a043769c26cca6e40e2be7437a))

## [0.1.52](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.51...auxx-v0.1.52) (2026-03-06)


### Features

* add Dockerfiles and health routes for homepage and docs ([#178](https://github.com/Auxx-Ai/auxx-ai/issues/178)) ([5120924](https://github.com/Auxx-Ai/auxx-ai/commit/512092486e1c80f08782e24b54f0b8391cd2c78e))

## [0.1.51](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.50...auxx-v0.1.51) (2026-03-06)


### Features

* add dynamic trigger input registration and unregistration ([#174](https://github.com/Auxx-Ai/auxx-ai/issues/174)) ([e7a4dd3](https://github.com/Auxx-Ai/auxx-ai/commit/e7a4dd3c90a908f8562eb8dbbbd9a1d1975357e0))
* add polling trigger functionality and related schema updates ([#172](https://github.com/Auxx-Ai/auxx-ai/issues/172)) ([4df0149](https://github.com/Auxx-Ai/auxx-ai/commit/4df0149604a84955397010ab3379228683d7cfe4))
* enhance multi-select functionality with create and manage optio… ([#177](https://github.com/Auxx-Ai/auxx-ai/issues/177)) ([0309c92](https://github.com/Auxx-Ai/auxx-ai/commit/0309c928b342f686563709c710dd677a28148ea4))
* implement import functionality for apps with validation and ups… ([#175](https://github.com/Auxx-Ai/auxx-ai/issues/175)) ([1c4d8a3](https://github.com/Auxx-Ai/auxx-ai/commit/1c4d8a3b78ff2495a0d0410fe89fd15975846cc4))
* update API routes for SDK webhooks and settings ([#170](https://github.com/Auxx-Ai/auxx-ai/issues/170)) ([1d502c8](https://github.com/Auxx-Ai/auxx-ai/commit/1d502c80ba907a0597919699e1f8113c522d4641))

## [0.1.50](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.49...auxx-v0.1.50) (2026-03-04)


### Features

* add app trigger test events and section components ([#168](https://github.com/Auxx-Ai/auxx-ai/issues/168)) ([bb0adbc](https://github.com/Auxx-Ai/auxx-ai/commit/bb0adbc7302d959149dd10f5b153ff418db9f297))
* add shared workflow connections and enhance webhook handling ([#166](https://github.com/Auxx-Ai/auxx-ai/issues/166)) ([ecc0f47](https://github.com/Auxx-Ai/auxx-ai/commit/ecc0f47b145481c98e6f4d8a63e0d3278794ff00))
* update Next.js configuration and package exports ([#169](https://github.com/Auxx-Ai/auxx-ai/issues/169)) ([098fe41](https://github.com/Auxx-Ai/auxx-ai/commit/098fe4160596142c38dad22e10a355e9a9cb7e04))

## [0.1.49](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.48...auxx-v0.1.49) (2026-03-04)


### Features

* add app trigger functionality to workflows ([#165](https://github.com/Auxx-Ai/auxx-ai/issues/165)) ([dc48fff](https://github.com/Auxx-Ai/auxx-ai/commit/dc48fffac8f1429026b2260211602fc9b64ec69c))
* add FieldDivider and FieldRow components for improved layout in… ([#161](https://github.com/Auxx-Ai/auxx-ai/issues/161)) ([f01dc9f](https://github.com/Auxx-Ai/auxx-ai/commit/f01dc9f84f42ed15b99b02e1ebb324da9277ab30))
* enhance workflow block error handling and validation ([#163](https://github.com/Auxx-Ai/auxx-ai/issues/163)) ([eb9a214](https://github.com/Auxx-Ai/auxx-ai/commit/eb9a214da450d310e33682274260d8cb01869e40))

## [0.1.48](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.47...auxx-v0.1.48) (2026-03-02)


### Features

* unify Lambda URL configuration ([#159](https://github.com/Auxx-Ai/auxx-ai/issues/159)) ([b1eaad5](https://github.com/Auxx-Ai/auxx-ai/commit/b1eaad59f3e287fc2f0463143410aee3f17b3167))

## [0.1.47](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.46...auxx-v0.1.47) (2026-03-02)


### Features

* update app icon display and enhance screenshot handling in app … ([#157](https://github.com/Auxx-Ai/auxx-ai/issues/157)) ([c6fda72](https://github.com/Auxx-Ai/auxx-ai/commit/c6fda721ba3264e58f390844d56665b87bdb131d))

## [0.1.46](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.45...auxx-v0.1.46) (2026-03-02)


### Features

* enhance output variable handling and introduce VarEditor compon… ([#155](https://github.com/Auxx-Ai/auxx-ai/issues/155)) ([c8c2572](https://github.com/Auxx-Ai/auxx-ai/commit/c8c2572d8548f67d2970c8836fe298615ddaad77))

## [0.1.45](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.44...auxx-v0.1.45) (2026-03-02)


### Features

* add support for app screenshots and enhance icon handling ([#153](https://github.com/Auxx-Ai/auxx-ai/issues/153)) ([7626230](https://github.com/Auxx-Ai/auxx-ai/commit/76262300afffbf10a1ccefccd14d14bf9573c119))

## [0.1.44](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.43...auxx-v0.1.44) (2026-03-02)


### Features

* add app icon upload component and presigned URL API for S3 uploads ([#151](https://github.com/Auxx-Ai/auxx-ai/issues/151)) ([cc428dd](https://github.com/Auxx-Ai/auxx-ai/commit/cc428dd968047b67b6b9d5cde3c8bcde05c9c726))

## [0.1.43](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.42...auxx-v0.1.43) (2026-03-01)


### Features

* implement internal authentication middleware and update auth ha… ([#148](https://github.com/Auxx-Ai/auxx-ai/issues/148)) ([4f4c510](https://github.com/Auxx-Ai/auxx-ai/commit/4f4c5105fa48af0136eb0b648832e53947540e3d))


### Bug Fixes

* remove unnecessary class from AppListCard component ([#150](https://github.com/Auxx-Ai/auxx-ai/issues/150)) ([4dba483](https://github.com/Auxx-Ai/auxx-ai/commit/4dba483c1598342ffa6f658cf43c4324add9718a))

## [0.1.42](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.41...auxx-v0.1.42) (2026-03-01)


### Features

* add shared test utilities and fixtures for integration tests ([#147](https://github.com/Auxx-Ai/auxx-ai/issues/147)) ([5f812f9](https://github.com/Auxx-Ai/auxx-ai/commit/5f812f9132f29e74613ebdf164d52abbd53070ab))
* implement HMAC signing for Lambda invocations and add callback … ([#145](https://github.com/Auxx-Ai/auxx-ai/issues/145)) ([36e1156](https://github.com/Auxx-Ai/auxx-ai/commit/36e1156a588da3a4339ea88288296388b7b65e8d))

## [0.1.41](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.40...auxx-v0.1.41) (2026-02-28)


### Features

* upgrade nodemailer and AWS SDK dependencies; refactor SES trans… ([#143](https://github.com/Auxx-Ai/auxx-ai/issues/143)) ([45441b8](https://github.com/Auxx-Ai/auxx-ai/commit/45441b822306f574d7cf302a0d482055bbb54faa))

## [0.1.40](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.39...auxx-v0.1.40) (2026-02-28)


### Features

* refactor email configuration and transport handling for S3 comp… ([#141](https://github.com/Auxx-Ai/auxx-ai/issues/141)) ([12899be](https://github.com/Auxx-Ai/auxx-ai/commit/12899bec507a24a305cea3aca386c4eafaccfc2d))

## [0.1.39](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.38...auxx-v0.1.39) (2026-02-28)


### Features

* refactor S3 client initialization and update download URL gener… ([#139](https://github.com/Auxx-Ai/auxx-ai/issues/139)) ([4f28860](https://github.com/Auxx-Ai/auxx-ai/commit/4f2886028373d92c8febfbd21681dfbce3ad1e00))

## [0.1.38](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.37...auxx-v0.1.38) (2026-02-28)


### Features

* enhance logging for Pusher auth and session verification processes ([#137](https://github.com/Auxx-Ai/auxx-ai/issues/137)) ([0f51f24](https://github.com/Auxx-Ai/auxx-ai/commit/0f51f244487ac57cfcbe4f4150762ba8ecb641c7))

## [0.1.37](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.36...auxx-v0.1.37) (2026-02-28)


### Features

* implement fallback state for dehydration failures in PortalLayout ([#135](https://github.com/Auxx-Ai/auxx-ai/issues/135)) ([4c9eba9](https://github.com/Auxx-Ai/auxx-ai/commit/4c9eba98c0bcf2bb4bd24b9f0b7e498e264da17c))

## [0.1.36](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.35...auxx-v0.1.36) (2026-02-28)


### Bug Fixes

* correct redirectURLs to redirectUrls in auth configuration ([#133](https://github.com/Auxx-Ai/auxx-ai/issues/133)) ([d7aebd4](https://github.com/Auxx-Ai/auxx-ai/commit/d7aebd4db501a5ab537ecfadf755db163e1d7453))

## [0.1.35](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.34...auxx-v0.1.35) (2026-02-28)


### Features

* remove export of constants from index file ([#131](https://github.com/Auxx-Ai/auxx-ai/issues/131)) ([e877f55](https://github.com/Auxx-Ai/auxx-ai/commit/e877f55e8148aae64a8d0b8c449c26897fa9f420))

## [0.1.34](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.33...auxx-v0.1.34) (2026-02-28)


### Features

* add API service implementation and environment variable loader ([#130](https://github.com/Auxx-Ai/auxx-ai/issues/130)) ([648e63e](https://github.com/Auxx-Ai/auxx-ai/commit/648e63eea42c0a4f15dc288caf06ca5d4577908b))
* enhance SDK publish workflow and add repository metadata ([#129](https://github.com/Auxx-Ai/auxx-ai/issues/129)) ([622ce55](https://github.com/Auxx-Ai/auxx-ai/commit/622ce5550af907cf496db3501d60a636e2beffc3))
* enhance SDK publish workflow with preflight checks ([#128](https://github.com/Auxx-Ai/auxx-ai/issues/128)) ([226594c](https://github.com/Auxx-Ai/auxx-ai/commit/226594c495bcad2b8d568313000317dfb083e07a))
* switch npm commands to pnpm for package verification and publis… ([#125](https://github.com/Auxx-Ai/auxx-ai/issues/125)) ([8462cd8](https://github.com/Auxx-Ai/auxx-ai/commit/8462cd817f2d8749859e3a3aa120b65d1756cad2))

## [0.1.33](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.32...auxx-v0.1.33) (2026-02-27)


### Features

* add cross-app login token functionality with Ed25519 signing ([#123](https://github.com/Auxx-Ai/auxx-ai/issues/123)) ([4d1a603](https://github.com/Auxx-Ai/auxx-ai/commit/4d1a603b9cde8b303feabffe727b70feb6d77c9f))
* implement queue metrics and job runs management with clear fail… ([#124](https://github.com/Auxx-Ai/auxx-ai/issues/124)) ([c48af6c](https://github.com/Auxx-Ai/auxx-ai/commit/c48af6c6d0efd07f8f2deb9b18fe087c04ec8236))
* refactor dehydrated state management and organization context h… ([#122](https://github.com/Auxx-Ai/auxx-ai/issues/122)) ([e09ed48](https://github.com/Auxx-Ai/auxx-ai/commit/e09ed488eb86745637e7c5b257b09788c1aaa8d1))
* refactor Stripe initialization and dynamically load PlanChangeS… ([#120](https://github.com/Auxx-Ai/auxx-ai/issues/120)) ([60bac33](https://github.com/Auxx-Ai/auxx-ai/commit/60bac33504985ab3ff7d835beb131d522b71c290))

## [0.1.32](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.31...auxx-v0.1.32) (2026-02-27)


### Features

* enhance docker-entrypoint.sh to support multiple URL replacements ([#118](https://github.com/Auxx-Ai/auxx-ai/issues/118)) ([73280b0](https://github.com/Auxx-Ai/auxx-ai/commit/73280b061f5706291761dfc8494b4069cdb835e4))

## [0.1.31](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.30...auxx-v0.1.31) (2026-02-27)


### Features

* specify platform for services in Docker Compose ([#116](https://github.com/Auxx-Ai/auxx-ai/issues/116)) ([4cc3c32](https://github.com/Auxx-Ai/auxx-ai/commit/4cc3c324130076be738771f28e99a4da5d9493ef))

## [0.1.30](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.29...auxx-v0.1.30) (2026-02-27)


### Features

* add one-click installation script and Docker Compose configuration ([#114](https://github.com/Auxx-Ai/auxx-ai/issues/114)) ([3a28bb1](https://github.com/Auxx-Ai/auxx-ai/commit/3a28bb178d2f4df7d21124878900f7fae32e0781))

## [0.1.29](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.28...auxx-v0.1.29) (2026-02-27)


### Features

* add migration stage for database dependencies in Dockerfile ([#112](https://github.com/Auxx-Ai/auxx-ai/issues/112)) ([475e218](https://github.com/Auxx-Ai/auxx-ai/commit/475e21859490ba672184af0efba77aee2f6e8e94))

## [0.1.28](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.27...auxx-v0.1.28) (2026-02-27)


### Features

* enhance Docker workflows and application metadata with build in… ([#110](https://github.com/Auxx-Ai/auxx-ai/issues/110)) ([74f61c7](https://github.com/Auxx-Ai/auxx-ai/commit/74f61c7f3d78e7575d3d266dcfefe884e9321af5))

## [0.1.27](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.26...auxx-v0.1.27) (2026-02-27)


### Features

* add warm configuration for production environments in Next.js apps ([#108](https://github.com/Auxx-Ai/auxx-ai/issues/108)) ([680e2c2](https://github.com/Auxx-Ai/auxx-ai/commit/680e2c286d4e23c60dc890b5e77923d248607c3e))

## [0.1.26](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.25...auxx-v0.1.26) (2026-02-27)


### Features

* add SDK_CLIENT_SECRET to Docker workflow and enhance user profi… ([#106](https://github.com/Auxx-Ai/auxx-ai/issues/106)) ([1530784](https://github.com/Auxx-Ai/auxx-ai/commit/1530784169c70f030e1690fa2c59b6b2345ce348))

## [0.1.25](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.24...auxx-v0.1.25) (2026-02-27)


### Features

* code structure for improved readability and maintainability ([#104](https://github.com/Auxx-Ai/auxx-ai/issues/104)) ([39bcbc2](https://github.com/Auxx-Ai/auxx-ai/commit/39bcbc2171e9a8f8c4accd16e93a84c1f68af4d2))

## [0.1.24](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.23...auxx-v0.1.24) (2026-02-26)


### Bug Fixes

* resolve circular dependency in ConfigService ([#102](https://github.com/Auxx-Ai/auxx-ai/issues/102)) ([5082432](https://github.com/Auxx-Ai/auxx-ai/commit/50824325f26e273da9911c28c64a2e739072f66e))

## [0.1.23](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.22...auxx-v0.1.23) (2026-02-26)


### Features

* add SDK_CLIENT_SECRET to env config and update related services ([#100](https://github.com/Auxx-Ai/auxx-ai/issues/100)) ([83fe932](https://github.com/Auxx-Ai/auxx-ai/commit/83fe9323fa37c3d5c0916f4823a72c2e799e59d7))

## [0.1.22](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.21...auxx-v0.1.22) (2026-02-26)


### Features

* enhance error handling in ConfigService and add TLS support in … ([#98](https://github.com/Auxx-Ai/auxx-ai/issues/98)) ([fba1f52](https://github.com/Auxx-Ai/auxx-ai/commit/fba1f521a84a9e2829c631df32466e448cddfb9a))

## [0.1.21](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.20...auxx-v0.1.21) (2026-02-26)


### Features

* update Redis instance name to AuxxAiRedisV3 ([#96](https://github.com/Auxx-Ai/auxx-ai/issues/96)) ([1e3aa1b](https://github.com/Auxx-Ai/auxx-ai/commit/1e3aa1b5bed5378369e74ecd47f40c55d9e3bab7))

## [0.1.20](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.19...auxx-v0.1.20) (2026-02-26)


### Features

* enhance Redis and Facebook/Instagram OAuth services ([#94](https://github.com/Auxx-Ai/auxx-ai/issues/94)) ([b494352](https://github.com/Auxx-Ai/auxx-ai/commit/b494352d32aa3d921ac599e8044ee622836c70b1))

## [0.1.19](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.18...auxx-v0.1.19) (2026-02-26)


### Features

* enhance Redis client and configuration management ([#92](https://github.com/Auxx-Ai/auxx-ai/issues/92)) ([a1c859f](https://github.com/Auxx-Ai/auxx-ai/commit/a1c859f467a8e0bc3e996a3796ce249e278f6c48))

## [0.1.18](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.17...auxx-v0.1.18) (2026-02-26)


### Features

* add tsdown dependency to pnpm workspace ([#91](https://github.com/Auxx-Ai/auxx-ai/issues/91)) ([41b4b5d](https://github.com/Auxx-Ai/auxx-ai/commit/41b4b5dc9f7df9b7de59e2c8e8887f7dc5b12e09))
* remove unused db models ([#88](https://github.com/Auxx-Ai/auxx-ai/issues/88)) ([7a6bc8e](https://github.com/Auxx-Ai/auxx-ai/commit/7a6bc8eee72dcd76b839eb265d069e4992c40af1))
* removed db models ([#90](https://github.com/Auxx-Ai/auxx-ai/issues/90)) ([cb5399b](https://github.com/Auxx-Ai/auxx-ai/commit/cb5399b2225eace27c758ee5ba4f6a4c54e45cf3))

## [0.1.17](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.16...auxx-v0.1.17) (2026-02-25)


### Features

* implement playwright testing ([#87](https://github.com/Auxx-Ai/auxx-ai/issues/87)) ([d38f5d3](https://github.com/Auxx-Ai/auxx-ai/commit/d38f5d3b30a20ab745ab5e2fc481a99e72cce90c))
* update imports and exports across packages for consistency ([#85](https://github.com/Auxx-Ai/auxx-ai/issues/85)) ([41d4058](https://github.com/Auxx-Ai/auxx-ai/commit/41d40583c7e3b2d2742cd12297235fe631988439))


### Bug Fixes

* remove deprecated @t3-oss/env-nextjs package references and clea… ([#83](https://github.com/Auxx-Ai/auxx-ai/issues/83)) ([7452829](https://github.com/Auxx-Ai/auxx-ai/commit/7452829610ecb19ffe8ea8f8ab574f4ab97bdeb6))
* update Dockerfiles to increase memory limit and improve pnpm dep… ([#86](https://github.com/Auxx-Ai/auxx-ai/issues/86)) ([d07af68](https://github.com/Auxx-Ai/auxx-ai/commit/d07af68a1ee488f435bbb3c39a76244da29c565a))

## [0.1.16](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.15...auxx-v0.1.16) (2026-02-24)


### Bug Fixes

* update ownership in Dockerfiles and enhance URL trust validation ([#81](https://github.com/Auxx-Ai/auxx-ai/issues/81)) ([78cc8a1](https://github.com/Auxx-Ai/auxx-ai/commit/78cc8a1bc5f7282c2417d71aa385f49d0bb1afd7))

## [0.1.15](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.14...auxx-v0.1.15) (2026-02-24)


### Features

* streamline database migration process and remove obsolete scripts ([#79](https://github.com/Auxx-Ai/auxx-ai/issues/79)) ([fb58833](https://github.com/Auxx-Ai/auxx-ai/commit/fb588333bac9dc9217059b0af28c4e17c1297fc6))

## [0.1.14](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.13...auxx-v0.1.14) (2026-02-24)


### Features

* unify application URL management and env variable config ([#77](https://github.com/Auxx-Ai/auxx-ai/issues/77)) ([39660ef](https://github.com/Auxx-Ai/auxx-ai/commit/39660ef2b922054272beab21211356f2886148a2))

## [0.1.13](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.12...auxx-v0.1.13) (2026-02-24)


### Features

* enhance application URL management and Redis config ([#76](https://github.com/Auxx-Ai/auxx-ai/issues/76)) ([ef51730](https://github.com/Auxx-Ai/auxx-ai/commit/ef51730cd427c7c0d27dc715c98a34b86cdadea5))
* enhance Outlook integration with error handling ([#73](https://github.com/Auxx-Ai/auxx-ai/issues/73)) ([9f13d84](https://github.com/Auxx-Ai/auxx-ai/commit/9f13d84d376d113d25446cd6562b8841db171a57))
* implement email job processing and worker for transactional emails ([#75](https://github.com/Auxx-Ai/auxx-ai/issues/75)) ([c848a0a](https://github.com/Auxx-Ai/auxx-ai/commit/c848a0a58b806ba21832c4996fea6f31b8e2a1ef))

## [0.1.12](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.11...auxx-v0.1.12) (2026-02-24)


### Features

* implement two-phase polling sync for Google and Outlook integra… ([#71](https://github.com/Auxx-Ai/auxx-ai/issues/71)) ([dd1ef42](https://github.com/Auxx-Ai/auxx-ai/commit/dd1ef4213c4d63231ada0dd2bfbe42ed622ec6c1))

## [0.1.11](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.10...auxx-v0.1.11) (2026-02-23)


### Features

* check sst deploy ([#69](https://github.com/Auxx-Ai/auxx-ai/issues/69)) ([42058b9](https://github.com/Auxx-Ai/auxx-ai/commit/42058b9210c11b016603197e4a71d4b7a71337f4))

## [0.1.10](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.9...auxx-v0.1.10) (2026-02-23)


### Bug Fixes

* enhance SST deploy and unlock workflows with additional input pa… ([#66](https://github.com/Auxx-Ai/auxx-ai/issues/66)) ([b533cb6](https://github.com/Auxx-Ai/auxx-ai/commit/b533cb62ae9ce5bb0c74219e02c3689fdf709d8a))

## [0.1.9](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.8...auxx-v0.1.9) (2026-02-23)


### Features

* **tests:** update variable validation and workflow graph tests for … ([#34](https://github.com/Auxx-Ai/auxx-ai/issues/34)) ([71b86f6](https://github.com/Auxx-Ai/auxx-ai/commit/71b86f69d5a7862fbf48f749fe1307dff5141f4a))


### Bug Fixes

* rename PORT to API_PORT for clarity and update related configura… ([#54](https://github.com/Auxx-Ai/auxx-ai/issues/54)) ([cc4e79a](https://github.com/Auxx-Ai/auxx-ai/commit/cc4e79aab46a00b0f3862962dcff688013a2d54b))
* update CI permissions to include pull-requests read access ([#52](https://github.com/Auxx-Ai/auxx-ai/issues/52)) ([7f5231d](https://github.com/Auxx-Ai/auxx-ai/commit/7f5231da5adb6d0beb8166f814e2f4e3ca42b792))
* update CORS configuration to support extra origins and improve m… ([#55](https://github.com/Auxx-Ai/auxx-ai/issues/55)) ([c442c95](https://github.com/Auxx-Ai/auxx-ai/commit/c442c959d0dd45304e8b1fd6c0168a63b9227297))
* update dependencies and adjust import paths for noble hashes ([#53](https://github.com/Auxx-Ai/auxx-ai/issues/53)) ([fcff17b](https://github.com/Auxx-Ai/auxx-ai/commit/fcff17b869b552d035e3237bfc33256f5289f055))
* update test suite for workflow engine and error handling ([#50](https://github.com/Auxx-Ai/auxx-ai/issues/50)) ([32b8f71](https://github.com/Auxx-Ai/auxx-ai/commit/32b8f71abfe4c07d37a95f1789f7b4a5a03ce097))

## [0.1.8](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.7...auxx-v0.1.8) (2026-02-23)


### Features

* add IntegrationTokenAccessor for managing encrypted integration… ([#31](https://github.com/Auxx-Ai/auxx-ai/issues/31)) ([da16326](https://github.com/Auxx-Ai/auxx-ai/commit/da16326b142412571ba027cdcefa97dc3335ca21))
* enhance integration sync status handling and add related tests ([#32](https://github.com/Auxx-Ai/auxx-ai/issues/32)) ([54b2ece](https://github.com/Auxx-Ai/auxx-ai/commit/54b2ececa9c71f90df78ce5ee978da0bf15ed1ca))

## [0.1.7](https://github.com/Auxx-Ai/auxx-ai/compare/auxx-v0.1.6...auxx-v0.1.7) (2026-02-23)


### Features

* **database:** implement environment variable management for DATABAS… ([#23](https://github.com/Auxx-Ai/auxx-ai/issues/23)) ([5f0c6a4](https://github.com/Auxx-Ai/auxx-ai/commit/5f0c6a4193a4dcbdbcf3e2cbdbbd9ab79e387ccd))


### Bug Fixes

* clean up CI workflows and Dockerfiles ([#28](https://github.com/Auxx-Ai/auxx-ai/issues/28)) ([a8cf34c](https://github.com/Auxx-Ai/auxx-ai/commit/a8cf34cf2a056d9cbcd7ff203a323db890c91fe7))
* optimize CI workflow by adding disk space cleanup and refining c… ([#29](https://github.com/Auxx-Ai/auxx-ai/issues/29)) ([fa2ad96](https://github.com/Auxx-Ai/auxx-ai/commit/fa2ad962267a30f50589f526859dd506ffdbe7e4))
* update Dockerfiles to refine build filters for SDK and web compo… ([#27](https://github.com/Auxx-Ai/auxx-ai/issues/27)) ([b17a862](https://github.com/Auxx-Ai/auxx-ai/commit/b17a862d7f21794ba4726b8c5b3870eeb82a949b))

## [0.1.6](https://github.com/auxxai/auxx-ai/compare/auxx-v0.1.5...auxx-v0.1.6) (2026-02-20)


### Bug Fixes

* update Dockerfiles and entrypoint for improved builds and runtim… ([#20](https://github.com/auxxai/auxx-ai/issues/20)) ([68d3c6c](https://github.com/auxxai/auxx-ai/commit/68d3c6c3cf5d20fbfd51e93b80490d3af7c43e35))
* update Dockerfiles to use consistent base image and improve depe… ([#22](https://github.com/auxxai/auxx-ai/issues/22)) ([accaaff](https://github.com/auxxai/auxx-ai/commit/accaaff28769dfa352850800ffbcc10576ce6174))

## [0.1.5](https://github.com/auxxai/auxx-ai/compare/auxx-v0.1.4...auxx-v0.1.5) (2026-02-17)


### Features

* add Docker image workflow and enhance organization details page… ([#17](https://github.com/auxxai/auxx-ai/issues/17)) ([4c3724b](https://github.com/auxxai/auxx-ai/commit/4c3724b59add769548819738d78c7ba455fe4768))


### Bug Fixes

* refine conditional logic for Docker image workflow steps ([#19](https://github.com/auxxai/auxx-ai/issues/19)) ([6c00005](https://github.com/auxxai/auxx-ai/commit/6c000054ee7237e965bfa85d5c73640e4f8da485))

## [0.1.4](https://github.com/auxxai/auxx-ai/compare/auxx-v0.1.3...auxx-v0.1.4) (2026-02-17)


### Bug Fixes

* add ActorInput component and integrate into workflow nodes ([#11](https://github.com/auxxai/auxx-ai/issues/11)) ([d0b3f49](https://github.com/auxxai/auxx-ai/commit/d0b3f498ab4e883cd44e8a48e70645ab2f0eb825))
* contacts and vendor parts services ([#15](https://github.com/auxxai/auxx-ai/issues/15)) ([7c20cee](https://github.com/auxxai/auxx-ai/commit/7c20cee2a8ccbafc5e9868a4e26b7917a631cb24))

## [0.1.3](https://github.com/auxxai/auxx-ai/compare/auxx-v0.1.2...auxx-v0.1.3) (2026-02-15)


### Features

* Feat/workflow crud ([#10](https://github.com/auxxai/auxx-ai/issues/10)) ([c5d300c](https://github.com/auxxai/auxx-ai/commit/c5d300cf803e73b6c8eb66575740a2e1c930244a))
* update color defaults and add new configuration options ([#9](https://github.com/auxxai/auxx-ai/issues/9)) ([22b0e83](https://github.com/auxxai/auxx-ai/commit/22b0e834737a9fb06a3eed3b2041d5cef39e0435))


### Bug Fixes

* resolve useExhaustiveDependencies lint warnings across codebase ([#6](https://github.com/auxxai/auxx-ai/issues/6)) ([96fa3d9](https://github.com/auxxai/auxx-ai/commit/96fa3d9fdab47689a956dce0b3e5e4b1e44415eb))

## [0.1.2](https://github.com/auxxai/auxx-ai/compare/auxx-v0.1.1...auxx-v0.1.2) (2026-02-14)


### Features

* add GitHub Action to validate PR titles ([d133d9b](https://github.com/auxxai/auxx-ai/commit/d133d9be3294514ee4cee60a69b01e8a76b6f5d4))

## [0.1.1](https://github.com/auxxai/auxx-ai/compare/auxx-v0.1.0...auxx-v0.1.1) (2026-02-13)


### Features

* add @auxx/types package and refactor imports ([9cc2a00](https://github.com/auxxai/auxx-ai/commit/9cc2a0062befc3bb5237f0399a54878c207915fa))
* add ACTOR field type and related functionality ([07d36a0](https://github.com/auxxai/auxx-ai/commit/07d36a08a2b077791d8eda90546df86e00e90b4d))
* add biome ignore comment for auto-generated files ([5d283b2](https://github.com/auxxai/auxx-ai/commit/5d283b2b9aca1834c3a01cb3577498f8dd899b6b))
* add build step for workspace packages and update package exports ([7dc2840](https://github.com/auxxai/auxx-ai/commit/7dc284005a4ea717d3a305ffde93d973b33e9d7d))
* add CALC field type and expression evaluation ([74538be](https://github.com/auxxai/auxx-ai/commit/74538be32e33e7aab0794846721b2a3b0535091c))
* add calc field type and related functionality ([7de06d9](https://github.com/auxxai/auxx-ai/commit/7de06d9ccae7e0aa9567462880c59bf706391ef1))
* add checkbox formatting support and enhance display options handling ([49a4575](https://github.com/auxxai/auxx-ai/commit/49a45751a4add358427e90c09607ad251f2725d4))
* add column signature support to virtualized table rows for improved rendering efficiency ([a660a51](https://github.com/auxxai/auxx-ai/commit/a660a5115291773d225c8205d80cfbbb982968ba))
* add configurable capability to field types for better field management ([3f4b99f](https://github.com/auxxai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* add create dialog support in field input adapter for relationship fields ([3f4b99f](https://github.com/auxxai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* add date parsing functionality and update task service ([f0f6d21](https://github.com/auxxai/auxx-ai/commit/f0f6d21329372bcee92f1bf2cd4416b106644148))
* add dialogs for editing column formatting and labels in dynamic tables ([f10d354](https://github.com/auxxai/auxx-ai/commit/f10d3544bf16b8992e73eb2f4ddb0978ec02d97a))
* add excludeIds prop to MultiRelationInput for filtering search results ([0e35f27](https://github.com/auxxai/auxx-ai/commit/0e35f27d7a8b4f8bafddedc9dcdddbd87b7524ae))
* add floating bulk action bar to dynamic table view ([0e35f27](https://github.com/auxxai/auxx-ai/commit/0e35f27d7a8b4f8bafddedc9dcdddbd87b7524ae))
* add GroupMemberService for managing group memberships and user actors ([b0c45f6](https://github.com/auxxai/auxx-ai/commit/b0c45f6684b7f9d2ffec52312a75234c6bf09071))
* add integration cache for organization provider lookups ([f094994](https://github.com/auxxai/auxx-ai/commit/f094994c83d4fe6e300002e1875a439034b6f6eb))
* add inventory, subparts, and vendors tabs to part drawer configuration ([8d829b1](https://github.com/auxxai/auxx-ai/commit/8d829b1827d6824183ca89c72577e145b31063a1))
* add JSON field support with display and input components ([77ab32c](https://github.com/auxxai/auxx-ai/commit/77ab32cfb31211b1f52ad5b0ca84938f508e6c4a))
* add kanban view components and functionality ([fec95e3](https://github.com/auxxai/auxx-ai/commit/fec95e3a081a3e5013876d95f3f16a94532678ad))
* add merge functionality with UI components ([96b564a](https://github.com/auxxai/auxx-ai/commit/96b564a1a5d18916473a679a9c2ad8f764ef4455))
* add NAME field support and link to source fields; enhance UI components with new task tab and styling updates ([e0c4315](https://github.com/auxxai/auxx-ai/commit/e0c4315e1051cfe2b97da7528574791df6c79a6f))
* add onClose prop to InlinePickerPopover and related components for improved picker management ([e00f0ea](https://github.com/auxxai/auxx-ai/commit/e00f0ea7d5796056c4b9a04235bca0217dccd46f))
* add platform detection and keyboard shortcuts for dialog submissions ([9b7e076](https://github.com/auxxai/auxx-ai/commit/9b7e0764a274a6ec1495296f25ed4fa257454058))
* add record link editor and badge components ([c9b5fc3](https://github.com/auxxai/auxx-ai/commit/c9b5fc336198306ca442ef26a347ea8997f5eefd))
* Add related entity definition ID to field values and update related services ([f2b5531](https://github.com/auxxai/auxx-ai/commit/f2b5531287ee9e0120719815350f0cefb084f1e2))
* add relationship field utilities and validation functions ([cc565d3](https://github.com/auxxai/auxx-ai/commit/cc565d36dde15cbbfc206aaf8bc363739bbf8e79))
* add release-please configuration for automated versioning ([3312539](https://github.com/auxxai/auxx-ai/commit/33125390dd2f3d220f7ac010fa2e255034191aa1))
* add skipInverseSync option to SetValue inputs for bulk operations ([d9c6bf8](https://github.com/auxxai/auxx-ai/commit/d9c6bf8395b715a9cae2d887499f7b8803f63a0a))
* add step to refresh SST state before deployment ([f5f7198](https://github.com/auxxai/auxx-ai/commit/f5f7198fe237b4fc78e18da978b17a4449f39602))
* add table view context and field view configuration ([cfa4ed3](https://github.com/auxxai/auxx-ai/commit/cfa4ed3de53b0b2268b535c5a09a0d23299c5527))
* add tag and thread entities with associated fields and queries ([6a9b38a](https://github.com/auxxai/auxx-ai/commit/6a9b38a62b6963f9a9896140cc02d204bfb50d08))
* add useEntityInstanceOperations hook for streamlined CRUD operations on entity instances ([a22a825](https://github.com/auxxai/auxx-ai/commit/a22a8255852214dca87e09596221fde373e88cf4))
* add useViewMutations hook for managing table views with store synchronization ([8d829b1](https://github.com/auxxai/auxx-ai/commit/8d829b1827d6824183ca89c72577e145b31063a1))
* check deployment ([e74aac1](https://github.com/auxxai/auxx-ai/commit/e74aac11e4df024b6f72a47a2833eba4cab7f7a0))
* consolidate and refactor custom field types and schemas for improved maintainability ([5afe681](https://github.com/auxxai/auxx-ai/commit/5afe681b3b56ae0c975db0f02468a5f99b884614))
* **database:** add field capability flags to CustomField and create FieldValue table ([f8a507e](https://github.com/auxxai/auxx-ai/commit/f8a507e69a56b51d98515742d0e6084e60a3e623))
* **database:** add index for entity instance and update timestamps ([a98f310](https://github.com/auxxai/auxx-ai/commit/a98f3109c35833e54df5df41e1955620dd642825))
* **database:** update journal and improve table view schema ([aaea7f5](https://github.com/auxxai/auxx-ai/commit/aaea7f52383db5b07da7af825a7d610485082c45))
* **database:** update journal with new entries and improve timestamp handling ([e1ba6ac](https://github.com/auxxai/auxx-ai/commit/e1ba6acf0b31504b9a92e46b7bbb76a8a1d542e7))
* deploy ([73ab0eb](https://github.com/auxxai/auxx-ai/commit/73ab0ebecc6e41397827813b7a018640f4e34b2f))
* **dialog:** add DialogFieldConfigRow component for configurable field visibility and ordering ([6233347](https://github.com/auxxai/auxx-ai/commit/62333476d9b685db2edb43024a4b65b9a2ab60f2))
* **dialogs:** enhance dialog forms with keyboard shortcuts for submission ([6093510](https://github.com/auxxai/auxx-ai/commit/60935109fbac88058465b9dd89619ad52fe758e8))
* **drafts:** add batch fetching of standalone draft metadata ([38704a9](https://github.com/auxxai/auxx-ai/commit/38704a9a163b8884bd226becbac0040cbfb916a2))
* **drawers:** implement BaseEntityDrawer and associated tab components ([8b1fbea](https://github.com/auxxai/auxx-ai/commit/8b1fbea5f93d85faf026bd2e98a87a4c08af61cc))
* **editor:** enhance draft handling with inReplyToMessageId and includePreviousMessage support ([2ed28a6](https://github.com/auxxai/auxx-ai/commit/2ed28a63988f400f3cfb03a9e5c295eeca81f49b))
* Enhance actor handling and UI components ([df5b6d7](https://github.com/auxxai/auxx-ai/commit/df5b6d79edf69f47c17d9ddd16ab6ea73914c8b3))
* enhance column drag-and-drop functionality and improve performance by syncing visible columns ([c925edb](https://github.com/auxxai/auxx-ai/commit/c925edbfa8b567a1af4c151b291c345b21e2664c))
* enhance custom field dialogs and entity management with improved state handling and UI updates ([c465018](https://github.com/auxxai/auxx-ai/commit/c4650180cf18271b5dd219f8e6b0655d1394b0ab))
* enhance custom field editors with inverse name handling ([02b9dec](https://github.com/auxxai/auxx-ai/commit/02b9dec742755f9f2880f9702b94fd70d79eab7a))
* Enhance custom field management with optimistic updates and new API endpoints ([d8a5880](https://github.com/auxxai/auxx-ai/commit/d8a58803e3572da78df7a7f27b4c91bc2bb4d88c))
* enhance custom field row with copy functionality and badge for system fields ([3f4b99f](https://github.com/auxxai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* enhance custom fields with ACTOR type support ([b0c45f6](https://github.com/auxxai/auxx-ai/commit/b0c45f6684b7f9d2ffec52312a75234c6bf09071))
* enhance dark mode styles and improve component responsiveness ([cfda688](https://github.com/auxxai/auxx-ai/commit/cfda68808c64bfefca1e478e2445562df55dcee5))
* enhance draft service with lightweight draft queries ([f094994](https://github.com/auxxai/auxx-ai/commit/f094994c83d4fe6e300002e1875a439034b6f6eb))
* Enhance dynamic table components with loading skeletons and improved filter handling ([4363acd](https://github.com/auxxai/auxx-ai/commit/4363acde2d02517312debc52ed5645d6d90528c4))
* Enhance dynamic table functionality with reconciled columns and dynamic field creation ([2c80586](https://github.com/auxxai/auxx-ai/commit/2c80586f045b7737c7ac4e5a91abbe8c31b77f71))
* enhance entity definition and instance services with display field recalculation ([1db190d](https://github.com/auxxai/auxx-ai/commit/1db190dfe99f10da37d5e3a725f9ed8aef6ddcb0))
* Enhance entity instance dialog initialization and prevent unnecessary resets ([af59fdb](https://github.com/auxxai/auxx-ai/commit/af59fdbfd7d7c34507272698c8ca65c439f62ab3))
* enhance entity instance fields with system attribute support ([3f4b99f](https://github.com/auxxai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* enhance entity records content and related components for improved field handling and visibility management ([5f9e92f](https://github.com/auxxai/auxx-ai/commit/5f9e92f0ab3259ebba239075b95510a5494d6120))
* enhance EntitySidebarNav icons with additional styling and refactor custom field exports for clarity ([a436d2d](https://github.com/auxxai/auxx-ai/commit/a436d2de8fabb9fb9782b0d6d77b51f6fa8ffc10))
* enhance field capabilities with isUnique property and add convenience properties to ResourceField ([d9c6bf8](https://github.com/auxxai/auxx-ai/commit/d9c6bf8395b715a9cae2d887499f7b8803f63a0a))
* Enhance field value handling and registry structure ([b94678f](https://github.com/auxxai/auxx-ai/commit/b94678f61411d6baee6775cfe2ef7e0c3b5d1327))
* Enhance field value handling with mutation version tracking and improved save responses ([4b01750](https://github.com/auxxai/auxx-ai/commit/4b01750cc8a859739a997a40bf8bc29a4c122ef5))
* Enhance field value retrieval with relationship traversal support ([e8c035f](https://github.com/auxxai/auxx-ai/commit/e8c035f54dca228fb8754606e9a3d03f4d1194d9))
* enhance inline-picker and mention editor with pattern preprocessing and improved badge rendering ([1e78883](https://github.com/auxxai/auxx-ai/commit/1e78883ca5bcf3de7a8aa6e66543bb798828bb55))
* enhance kanban column and view with unified settings callback and drag overlay improvements ([9500679](https://github.com/auxxai/auxx-ai/commit/95006795d0987948d133d812f5839c8862e2a330))
* enhance kanban column settings and update view configuration ([b3a33f4](https://github.com/auxxai/auxx-ai/commit/b3a33f4f7b2977f26787c4311bde15289a2e830f))
* enhance Kanban components with inline editing and custom field integration ([fb55a16](https://github.com/auxxai/auxx-ai/commit/fb55a160d3fa82466882c991d6e0c5e14279658c))
* Enhance Kanban functionality with multi-select and bulk updates ([0629396](https://github.com/auxxai/auxx-ai/commit/062939623a976ee68799433c966ef57ed78cac30))
* enhance loading state management with auto-fetch and layout effects in hooks ([2aa5a1d](https://github.com/auxxai/auxx-ai/commit/2aa5a1dbf00fd20b9f24c28b273ea35d6e504487))
* enhance part and ticket fields with system attributes ([a03640a](https://github.com/auxxai/auxx-ai/commit/a03640a590db5a3e1f3a4e9f8d614ec4fd770eec))
* enhance picker components with external anchor support and improved state management ([ce96aa3](https://github.com/auxxai/auxx-ai/commit/ce96aa3b40534751ca5bd70306764334eb7fe111))
* enhance preflight check scripts to strip quotes and manage SST variables ([84d5131](https://github.com/auxxai/auxx-ai/commit/84d513135af830d381f978b5b2eb25a33ed6c1cc))
* Enhance relationship handling in field value management ([78adf7c](https://github.com/auxxai/auxx-ai/commit/78adf7c2b41eb5b4a98d3e4d17904d47af56cbc9))
* enhance resource handling with ResourceId type and utility functions ([53aa1ec](https://github.com/auxxai/auxx-ai/commit/53aa1ec93bf1afa8cd6cc2e7d87937fd59d84960))
* enhance resource router to support typed cursor object for pagination ([0e35f27](https://github.com/auxxai/auxx-ai/commit/0e35f27d7a8b4f8bafddedc9dcdddbd87b7524ae))
* enhance search functionality and UI components ([ca06b38](https://github.com/auxxai/auxx-ai/commit/ca06b389468b1887957085e5871792ad3caf46d5))
* enhance SST deploy workflow with concurrency and AWS identity verification ([a070893](https://github.com/auxxai/auxx-ai/commit/a0708930eabc61691a23c07e53e961c53de0c3fd))
* Enhance task management with deadline handling and completed task filtering ([a29f75c](https://github.com/auxxai/auxx-ai/commit/a29f75c1caf5fcaf637b7f1902a0f3d17b37189e))
* enhance type operator map and condition builders ([1cf2a41](https://github.com/auxxai/auxx-ai/commit/1cf2a411814d9fd811c1980a7d9fb725a7bb92f7))
* **entity-instances:** extend entity instance creation parameters ([56ded83](https://github.com/auxxai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))
* extend field types to include color, target time, and celebration properties for Kanban integration ([a22a825](https://github.com/auxxai/auxx-ai/commit/a22a8255852214dca87e09596221fde373e88cf4))
* extend RESOURCE_DISPLAY_CONFIG to include relations for contact and customer tables ([0e35f27](https://github.com/auxxai/auxx-ai/commit/0e35f27d7a8b4f8bafddedc9dcdddbd87b7524ae))
* finalize dynamic table refactor - replace all legacy files ([8315f2d](https://github.com/auxxai/auxx-ai/commit/8315f2d4d8e8eec7fd492462af9902d88dffdd07))
* **groups:** add entity group management functionality ([bbaeb07](https://github.com/auxxai/auxx-ai/commit/bbaeb07628dc1f4619d3562d70d42643adec7371))
* implement Actor handling across components and services, enhancing actor data extraction and display ([25695aa](https://github.com/auxxai/auxx-ai/commit/25695aa83c855a523c0faa88b805c799b03a4a0d))
* implement Command component with drag-and-drop sorting and navigation features ([a033be3](https://github.com/auxxai/auxx-ai/commit/a033be390c8450622c59743eec247261a5010e39))
* implement computed field functionality with caching and automatic invalidation ([33ded19](https://github.com/auxxai/auxx-ai/commit/33ded192bc5a5944b8550e350f0d7058559669a7))
* implement contact hooks for validation and normalization ([060f1bc](https://github.com/auxxai/auxx-ai/commit/060f1bcf59f0ebe914f75bf32237f1bfc69fb22e))
* Implement custom field value store and hydration logic ([6dbfb6b](https://github.com/auxxai/auxx-ai/commit/6dbfb6ba55872e6c31edb93ec0a380b44baef8ab))
* implement entity appearance and definition editors, enhance slug validation, and improve custom field management ([9499f9a](https://github.com/auxxai/auxx-ai/commit/9499f9a41e99eea4de0c235a03a905034ef638a7))
* Implement entity merging functionality ([3bea692](https://github.com/auxxai/auxx-ai/commit/3bea692cb4bdc1c8309a9831e89ac1f402e7856b))
* implement field path breadcrumbs and enhance column ID handling for dynamic tables ([92ac001](https://github.com/auxxai/auxx-ai/commit/92ac0015f7a014020931eced83bcc61ac9be776e))
* Implement field value fetch queue and enhance auto-fetch capabilities for field values ([aaa60cd](https://github.com/auxxai/auxx-ai/commit/aaa60cdcbf7e182b90ce09fefd30107919fdc02a))
* implement FieldDisplay component for read-only field rendering and refactor display components to use useFieldContext hook ([248002e](https://github.com/auxxai/auxx-ai/commit/248002ea9435750d8accc76673b37963e01d1a6d))
* Implement name input handling and dialog mode for email editor ([ffdb86f](https://github.com/auxxai/auxx-ai/commit/ffdb86f1448201860852c2ecbec9be700225da90))
* implement optimistic updates for entity definitions and enhance resource store management ([fea13ef](https://github.com/auxxai/auxx-ai/commit/fea13ef693d4143a86d2386f5057487d27ff0d63))
* implement optimistic updates for thread mutations and refactor thread list management ([d40094d](https://github.com/auxxai/auxx-ai/commit/d40094df70c15caf2a54c01a456a7473626ddbc5))
* implement record fetching and caching system ([138a541](https://github.com/auxxai/auxx-ai/commit/138a5416656274eca535e7dd82b1567a56e2c91d))
* Implement Resource Picker Component ([2233a70](https://github.com/auxxai/auxx-ai/commit/2233a70ccb146f6025fa0e2ecb122d40dc35df84))
* implement ResourceBadge component and enhance resource linking utilities ([0785746](https://github.com/auxxai/auxx-ai/commit/078574663d93f4d1e81eb88828a9235fe091a0c8))
* Implement ResourcePicker component with field selection and relationship drill-down functionality ([0e7673f](https://github.com/auxxai/auxx-ai/commit/0e7673f013103bd466fcc97af65cd73510a1dfb7))
* implement row selection context and improve checkbox handling ([2908448](https://github.com/auxxai/auxx-ai/commit/290844878c4a63bd8985e115a344ec3d4de698cc))
* Implement session filters for dynamic table and enhance view management ([8f989e4](https://github.com/auxxai/auxx-ai/commit/8f989e4af257927a577f63b78a2dca57d10c7209))
* implement shared resize context and provider for responsive components ([c448b90](https://github.com/auxxai/auxx-ai/commit/c448b90eb75faf33347f129590a347e47d371552))
* implement table UI store and view store for dynamic table management ([4a95e2d](https://github.com/auxxai/auxx-ai/commit/4a95e2d4ca307be2ecc19fa34c602ffa43b80f03))
* Implement unified handler for CRUD operations ([44630cc](https://github.com/auxxai/auxx-ai/commit/44630cc29b9294714b2d30c0568dd4373b1a5637))
* implement useRecordBatchFetcher hook for batch fetching records ([0e35f27](https://github.com/auxxai/auxx-ai/commit/0e35f27d7a8b4f8bafddedc9dcdddbd87b7524ae))
* implement useResources hook for better resource management ([3f4b99f](https://github.com/auxxai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* implement useWorkflowVariableEditor hook and refactor variable editing components with inline-picker support ([2a60b02](https://github.com/auxxai/auxx-ai/commit/2a60b022e5423f0c3c904b6be3b21f80e6e55a9a))
* implement value converter for typed field values ([a13fab2](https://github.com/auxxai/auxx-ai/commit/a13fab22ca9af58292a557de31294f1d2871ad9b))
* improve table filter and view selector components with enhanced UI and functionality ([f24b62a](https://github.com/auxxai/auxx-ai/commit/f24b62a4f53979c3024dcaddab4002ca601ece38))
* **inbox:** update field keys to use inbox_ prefix for consistency ([59ac6c6](https://github.com/auxxai/auxx-ai/commit/59ac6c66dede29bdfc9bf2effec03b6952d4d4d8))
* integrate ComboPicker for field type selection in CustomFieldDialog ([0a499aa](https://github.com/auxxai/auxx-ai/commit/0a499aa0c7f5a1f5efd30a7ab686df066cb82361))
* introduce display options schema for NUMBER, DATE, CHECKBOX fields ([d9c6bf8](https://github.com/auxxai/auxx-ai/commit/d9c6bf8395b715a9cae2d887499f7b8803f63a0a))
* introduce ID-first batch-fetch methods in thread query service ([f094994](https://github.com/auxxai/auxx-ai/commit/f094994c83d4fe6e300002e1875a439034b6f6eb))
* Introduce unified condition-based filtering for threads ([4e4f152](https://github.com/auxxai/auxx-ai/commit/4e4f1522c42c16d61f882c200d02222e6538df3c))
* **mail:** implement full counts for sidebar and optimize thread read status updates ([78a0f6f](https://github.com/auxxai/auxx-ai/commit/78a0f6fc0acfc15e5aa6e9dfe9e4800d8cf09717))
* **members:** add membership retrieval and active member count methods ([56ded83](https://github.com/auxxai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))
* **organizations:** refactor owner verification to use membership service ([56ded83](https://github.com/auxxai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))
* **phone-input:** update CountrySelect button styles and remove unused icon ([836a9ad](https://github.com/auxxai/auxx-ai/commit/836a9adebb871ecfa9e7b22720258bafbe84e7d2))
* **phone:** add phone formatting options and editor integration ([4f6c9a9](https://github.com/auxxai/auxx-ai/commit/4f6c9a9c984618cb3928fec05f1c04f4f33b928c))
* **redis:** add set operations to Redis clients ([56ded83](https://github.com/auxxai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))
* Refactor CRUD handlers to utilize ResourceId for custom fields ([0435953](https://github.com/auxxai/auxx-ai/commit/04359532bcae2628fde3adc7e658a3bbfe4cd436))
* Refactor custom field handling and improve resource field management ([480e853](https://github.com/auxxai/auxx-ai/commit/480e8539234c31282b8775d96b423e86d91d3241))
* refactor custom fields to support primary display field auto-setting and remove text input node ([a234648](https://github.com/auxxai/auxx-ai/commit/a234648f9061376431064c4d4df8606433818a33))
* refactor display options types to use FieldOptions for consistency across components ([542f3b3](https://github.com/auxxai/auxx-ai/commit/542f3b34a2c9021e1850e9b3a09a36e8bc4097b5))
* refactor entity appearance editor to use resource object and disable editing for system resources ([3f4b99f](https://github.com/auxxai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* refactor EntityRecordDrawer and related components to use ResourceId format and enhance preset value handling ([b668ced](https://github.com/auxxai/auxx-ai/commit/b668ced767375b7e1e00fd57a6a4fbac055b0904))
* refactor field handling in calc editor, introduce FieldBadge component, and update formula conversion logic ([e0d6b23](https://github.com/auxxai/auxx-ai/commit/e0d6b23cf6ed00229af7d7d2c2912829ab32cf60))
* refactor field identification across resources ([5b8e1d1](https://github.com/auxxai/auxx-ai/commit/5b8e1d1a11897a049f68d725fcfbeee81bc0a408))
* Refactor field input handling and introduce FieldInputAdapter ([8f5662a](https://github.com/auxxai/auxx-ai/commit/8f5662a55d4b7a689d9571d1492d9a44d1dd8582))
* Refactor field value handling and relationship utilities ([c51713d](https://github.com/auxxai/auxx-ai/commit/c51713d65737462af25eaefe2f9400dfc8c26ed4))
* refactor field value handling to use useFieldValue hook for improved reactivity and performance ([e757077](https://github.com/auxxai/auxx-ai/commit/e7570779522f49254308a600b133ec264046d4b8))
* Refactor inbox and message handling ([848468f](https://github.com/auxxai/auxx-ai/commit/848468f83dadd6f8be8ff1971c4d694b082bd3de))
* refactor Kanban column settings to use dropdown menu instead of popover for improved UX ([a22a825](https://github.com/auxxai/auxx-ai/commit/a22a8255852214dca87e09596221fde373e88cf4))
* refactor onboarding components to use dehydrated state and improve organization management ([8db17c2](https://github.com/auxxai/auxx-ai/commit/8db17c2cb2e052934afb72b33614bf5ec07d27af))
* Refactor relationship handling to use inverseResourceFieldId and improve relationship config management ([4f03edc](https://github.com/auxxai/auxx-ai/commit/4f03edc0fd5c3ec36794050b8b4ec86ebb585b75))
* Refactor relationship sync and save field value handling for type-safe field identification ([5f26601](https://github.com/auxxai/auxx-ai/commit/5f26601c1c94f581e2275937d7db224be4dd618d))
* Refactor resource handling to use record IDs for consistency across components ([86f88e6](https://github.com/auxxai/auxx-ai/commit/86f88e665f15e56f574cc04744d68dc9b653f0c8))
* Refactor resource handling to use ResourceId format ([816deaf](https://github.com/auxxai/auxx-ai/commit/816deafd9a81775faa2ee53ae979aba939905176))
* refactor safety check script to use grep instead of ripgrep ([856e286](https://github.com/auxxai/auxx-ai/commit/856e286d6aca00dc9f0b1ecde3c36501c0a88af6))
* Refactor task assignment handling to use ActorId and implement concurrency semaphore for rate limiting ([4d9d3d2](https://github.com/auxxai/auxx-ai/commit/4d9d3d22b446952ad3486bd216673f4eab888f12))
* refactor task handling to use ResourceId format and update related components ([27d18e2](https://github.com/auxxai/auxx-ai/commit/27d18e2d1f745f35f394c54ebc980f80fe629879))
* refactor task management and UI components for improved functionality and user experience ([b46ebae](https://github.com/auxxai/auxx-ai/commit/b46ebaeb5486e973f79d64b876813c49d8af1795))
* Refactor ticket event types and hooks for improved event handling ([bd2b8f9](https://github.com/auxxai/auxx-ai/commit/bd2b8f971ea5ad331b834b6da0538c6154106497))
* **relationships:** implement inverse relationship sync and enhance relationship metadata handling ([77a05c2](https://github.com/auxxai/auxx-ai/commit/77a05c2a285b95d769caced553795ef863fd35e1))
* remove system Pulumi to avoid version conflict with SST ([56dee33](https://github.com/auxxai/auxx-ai/commit/56dee33dbea954df7d9bf449e4b09c69d041fb86))
* **resource-access:** implement resource access management ([56ded83](https://github.com/auxxai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))
* **search:** implement global search functionality with full-text support and pagination ([a77c8ef](https://github.com/auxxai/auxx-ai/commit/a77c8ef51e31ff3cce673109fef02bc4f2dc50b7))
* **search:** implement new search store and selectors for mail search functionality ([720eaf2](https://github.com/auxxai/auxx-ai/commit/720eaf219b8bd4fc9194e0ae515e663859031c21))
* **search:** refactor search store to use conditions instead of filters ([efda864](https://github.com/auxxai/auxx-ai/commit/efda8647b5a57c517064ec6ba9ddebb59d4f3f6b))
* **signatures:** add signature management components and API integration ([731c4e2](https://github.com/auxxai/auxx-ai/commit/731c4e2034ae33dd8bf134873c6a61577aa7bfea))
* specify exact Deno version in deployment workflow ([c583bc5](https://github.com/auxxai/auxx-ai/commit/c583bc5a923a7ed9ba183128c36aa86d2e42510d))
* **task:** add task management types and utilities ([4de361a](https://github.com/auxxai/auxx-ai/commit/4de361a87051a2210c9d4733d6251c7f15714dcc))
* **ui:** enhance emoji picker exports and add emoji utilities ([c8a9f1e](https://github.com/auxxai/auxx-ai/commit/c8a9f1ecb3f48739060565d9289441d16dcc5210))
* update AWS provider configuration to conditionally include profile based on GITHUB_ACTIONS ([b0769bb](https://github.com/auxxai/auxx-ai/commit/b0769bbe665d6f90392b22c0ac1955e640490a23))
* update AWS resource ([bf193d1](https://github.com/auxxai/auxx-ai/commit/bf193d14d6b75d584cebd0c4fb4d42a463ca01ba))
* update createRelationshipFieldWithInverse to handle relatedResourceId format ([d9c6bf8](https://github.com/auxxai/auxx-ai/commit/d9c6bf8395b715a9cae2d887499f7b8803f63a0a))
* update default visibility for custom fields in dynamic table to false ([8d829b1](https://github.com/auxxai/auxx-ai/commit/8d829b1827d6824183ca89c72577e145b31063a1))
* update imports and types across various modules ([e9bdde7](https://github.com/auxxai/auxx-ai/commit/e9bdde704d038a02e62dcba837cbe8160f006980))
* update InlinePickerPopover to use Radix Popover for positioning and remove deprecated containerRef prop ([76c6e05](https://github.com/auxxai/auxx-ai/commit/76c6e0518d370a0e73face26bc02735cf0c38e7b))
* update resource handling to use entityDefinitionId instead of tableId across components and services ([17bcea4](https://github.com/auxxai/auxx-ai/commit/17bcea4fb34fc650a0a67ec414530947d9acef90))
* update resource instantiation to remove version suffix ([7a32d39](https://github.com/auxxai/auxx-ai/commit/7a32d399dbac58e2838b7529b2580b580699e32a))
* update SST configuration to include database deployment function name ([97713c0](https://github.com/auxxai/auxx-ai/commit/97713c0eee792f245315ed7e4243f27e4943c530))
* update Stripe client initialization to use console warning instead of throwing an error ([04696d5](https://github.com/auxxai/auxx-ai/commit/04696d5654b29d62ae5b29dfa33120f4400a4bb7))
* update VPC instantiation to remove version suffix ([cfc50d3](https://github.com/auxxai/auxx-ai/commit/cfc50d3b85046c1c6cbaa076d376318772aa3007))
* **utils:** add utility functions for ID generation, header filtering, and MIME handling ([5bb9707](https://github.com/auxxai/auxx-ai/commit/5bb97075168524383b40ae5af189ddd34770fd2f))
* **var-editor:** update border styling for field row variants ([368e0ff](https://github.com/auxxai/auxx-ai/commit/368e0ff1e9a0ec1d7edb317b79c293f1914803f2))
* **workflow:** update approval query service to use new group membership model ([56ded83](https://github.com/auxxai/auxx-ai/commit/56ded8372263d6d00aa5b9794ea02e51dae7ec5c))


### Bug Fixes

* adjust contact drawer layout for better responsiveness ([e109d52](https://github.com/auxxai/auxx-ai/commit/e109d52dbc93105758100dd828e0c6a6fa6e666c))
* adjust Kanban view to handle column IDs consistently and improve card selection logic ([a22a825](https://github.com/auxxai/auxx-ai/commit/a22a8255852214dca87e09596221fde373e88cf4))
* **billing:** Fix bug in subscription management with user tracking and reactivation handling ([13fa784](https://github.com/auxxai/auxx-ai/commit/13fa784821d77016b1ac896ef59cbc3f878aa771))
* clean up variable utilities and remove deprecated functions ([3f4b99f](https://github.com/auxxai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* enhance phone-input component with data-slot attribute ([d9c6bf8](https://github.com/auxxai/auxx-ai/commit/d9c6bf8395b715a9cae2d887499f7b8803f63a0a))
* improve record store state management in useRecordStore ([0e35f27](https://github.com/auxxai/auxx-ai/commit/0e35f27d7a8b4f8bafddedc9dcdddbd87b7524ae))
* improve toast component with better event handling and structure ([d9c6bf8](https://github.com/auxxai/auxx-ai/commit/d9c6bf8395b715a9cae2d887499f7b8803f63a0a))
* invalidate resource.search queries in invalidateResource functions ([0e35f27](https://github.com/auxxai/auxx-ai/commit/0e35f27d7a8b4f8bafddedc9dcdddbd87b7524ae))
* modify TicketRow to navigate with drawer open via URL param ([0e35f27](https://github.com/auxxai/auxx-ai/commit/0e35f27d7a8b4f8bafddedc9dcdddbd87b7524ae))
* optimize unread service to directly filter by inboxId ([f094994](https://github.com/auxxai/auxx-ai/commit/f094994c83d4fe6e300002e1875a439034b6f6eb))
* streamline variable explorer by removing unnecessary imports ([3f4b99f](https://github.com/auxxai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* update entity fields component to use custom field mutations and improve field handling ([3f4b99f](https://github.com/auxxai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* update entity instance operations to use custom field mutations ([3f4b99f](https://github.com/auxxai/auxx-ai/commit/3f4b99f3ad39d25ab1648bdbee37085fcddc8818))
* update options handling in updateCustomField to support flat display options ([d9c6bf8](https://github.com/auxxai/auxx-ai/commit/d9c6bf8395b715a9cae2d887499f7b8803f63a0a))
* update package exports for field-value types ([a13fab2](https://github.com/auxxai/auxx-ai/commit/a13fab22ca9af58292a557de31294f1d2871ad9b))
* update PartsContent to use resourceId instead of partId for drawer ([8d829b1](https://github.com/auxxai/auxx-ai/commit/8d829b1827d6824183ca89c72577e145b31063a1))
* update resource registry service to handle new field options structure with additional properties ([a22a825](https://github.com/auxxai/auxx-ai/commit/a22a8255852214dca87e09596221fde373e88cf4))
* update ResourceProvider to utilize useRecordBatchFetcher ([0e35f27](https://github.com/auxxai/auxx-ai/commit/0e35f27d7a8b4f8bafddedc9dcdddbd87b7524ae))
* update snippets router to use new group member schema ([0e35f27](https://github.com/auxxai/auxx-ai/commit/0e35f27d7a8b4f8bafddedc9dcdddbd87b7524ae))
* update ticket reply item to allow nullable email field ([e109d52](https://github.com/auxxai/auxx-ai/commit/e109d52dbc93105758100dd828e0c6a6fa6e666c))
* update variable types to use relatedEntityDefinitionId for better clarity ([8d829b1](https://github.com/auxxai/auxx-ai/commit/8d829b1827d6824183ca89c72577e145b31063a1))
