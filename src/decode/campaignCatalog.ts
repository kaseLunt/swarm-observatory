// ── THE TRUSTED CAMPAIGN CATALOG (the H1 lesson applied AT BIRTH) ─────────────────────────────────────────
// A campaign is 50 per-seed bundles + a vendored campaign-manifest.json. That manifest is fetched over the
// network and is UNSIGNED — it "folds into nothing" (its own schema says so: campaign-manifest-sidecar/v0,
// derived, non-authoritative). Letting the fetched manifest decide WHICH bytes load and WHAT identity each
// seed must recompute-to would hand a tampered sidecar the verdict: a swapped `bundle_det_sha256` row, or a
// re-pointed per-seed path, could green a seed against forged pins. The runCatalog H1 fix taught the lesson
// once (runs/index.json is discovery, the in-bundle catalog is authority); we apply it HERE at the campaign's
// birth rather than retrofitting it after a scare.
//
// THIS module is the AUTHORITY, pinned IN THE APP BUNDLE:
//   • the precommit `planId` (the ONE identity the campaign's verdict binds — echoed by the manifest, owned
//     here) and the campaign's certified verdict level;
//   • the 50 per-seed pins {caseId, resultId, sha256, len}. caseId/resultId are the certified per-seed
//     identities (authority: EXP-F3a-robust.json.pinned_variants); sha256/len are derived over the vendored
//     bundle.det bytes (build-bound, D-002 — they re-derive per identity but are byte-stable for THIS drop).
//   • the load base — each seed's bytes come from `${base}/${seed}/bundle.det`, DERIVED from the pinned base
//     and the seed number, NEVER from a manifest field. The seed→bytes path cannot be redirected.
// The fetched campaign-manifest.json keeps only its DISCOVERY role (enumerate the ensemble, show the aggregate
// NEES/NIS ceremony). A conformance drift gate (publication.test.ts) pins: catalog pins ⇄ vendored manifest
// rows ⇄ actual vendored bundle sha256 — so the three can never silently diverge.
//
// TRUST BASIS: a seed the spine marks 'verified' means the worker RECOMPUTED the bundle's case_id/result_id
// AND its sha256 and matched THESE pins. Because these pins ARE the manifest-grade campaign identity (not a
// bundle's own self-derived trailer), that verdict is manifest-grade — RunSummary carries basis
// 'campaign-manifest' EXPLICITLY so a consumer (W5) can never confuse it with det-only self-consistency.

export interface CampaignSeedPin {
  readonly seed: number
  readonly caseId: string   // certified per-seed case_id (authority: EXP-F3a-robust.json.pinned_variants)
  readonly resultId: string // certified per-seed result_id
  readonly sha256: string   // sha256 over the vendored bundle.det bytes (build-bound; drift-gated)
  readonly len: number      // bundle.det length in bytes
}

// The EXPECTED aggregate-gauge identity AND the certified statistical TUPLE — the in-bundle AUTHORITY the Wall
// validates the fetched manifest's statistical block against (W5 F3 shape + F1 values). The vendored manifest's
// statistical_pointer "folds into nothing" (unsigned, derived), so a tampered/stale sidecar could drop a member,
// forge a kind, skew a bound, or flip a statistic/pass; parseCampaignGauges fail-CLOSES against THESE pins rather
// than trusting whatever the sidecar declares. The Wall thus renders CATALOG truth CONFIRMED by the fetch — never
// raw fetch truth. Every certified field is pinned here per member: the statistic + pass DECISION, the two
// critical-bound f64 bit-strings (the bearings-class pinned-bit display, decoded but never platform-recomputed),
// dof, alpha (ppm), and sidedness. member_count and the test_id ⇄ kind identities complete the shape.
//
// TWO PIN LAYERS, one truth, independent copies (F1). This catalog is the RUNTIME authority: a fetched value that
// differs from a pin here is rejected, so a tampered FETCH can never reach the screen. publication.test.ts holds
// a SECOND, independent literal copy (PINNED_GAUGES) as a CI drift gate: because it never imports these pins, a
// COORDINATED edit that forged BOTH this catalog AND the vendored manifest to agree would still fail there (the
// frozen literal is a third witness the coordinated pair cannot move). Catalog guards the user; the gate guards
// the catalog. Keep the two in agreement with the vendored manifest — the drift gate fails loudly if they drift.
export interface CampaignStatMember {
  readonly testId: number      // the certifier's test_id (NEES=2, NIS=3)
  readonly kind: string        // 'CHI2_NEES' | 'CHI2_NIS' — the certifier's test kind
  readonly statistic: string   // certifier-recomputed statistic, byte-exact text (displayed verbatim, pinned)
  readonly pass: boolean        // the certified pass/fail DECISION (statistical, not byte-integrity)
  readonly dof: number
  readonly alphaPpm: number
  readonly sidedness: string   // the raw pinned token ('TWO' | 'ONE'), decoded to two-/one-sided at render
  readonly loBits: string      // critical_lo_bits — 16 lowercase hex, big-endian IEEE-754 f64 (pinned)
  readonly hiBits: string      // critical_hi_bits
}
export interface CampaignStatSpec {
  readonly schemaPrefix: string          // the sidecar schema family the manifest MUST declare (fail-closed)
  readonly verdictSchemaVersion: number  // the StatResultBlock schema version the certifier emits (2)
  readonly members: readonly CampaignStatMember[] // the EXACT expected set + each member's certified tuple
}

export interface CampaignCatalog {
  readonly campaignId: string     // stable id: 'robust-f3a'
  readonly experiment: string     // 'EXP-F3a'
  readonly profile: string        // 'robust-f3a'
  readonly planId: string         // the precommit plan_id — the campaign's bound identity
  readonly verdictLevel: number   // 2 (ROBUST)
  readonly verdictLevelName: string
  readonly nSeeds: number         // 50
  readonly attemptsPerVariant: number // 3 (D1: byte-identical across attempts; one representative vendored)
  readonly base: string           // load base under public/ — seed bytes are `${base}/${seed}/bundle.det`
  readonly manifestUrl: string    // discovery-only vendored manifest (NEVER authority)
  readonly stat: CampaignStatSpec // the expected aggregate-gauge shape (W5 F3 fail-closed validation authority)
  readonly seeds: readonly CampaignSeedPin[]
}

// The 50-seed robust-f3a ensemble, pinned. Generated from EXP-F3a-robust-campaign-manifest.json's seeds.index
// (whose rows echo EXP-F3a-robust.json.pinned_variants); kept in agreement with the vendored manifest AND the
// vendored bundle bytes by the drift gate in publication.test.ts.
const ROBUST_F3A_SEEDS: readonly CampaignSeedPin[] = [
  { seed: 42, caseId: '0b82614b372b0f9e90d64f32a3c8b04ed76563ceee13837c19bd9955ca76073a', resultId: '9130689461912599b43cae77ba8cb6fc85ba032c0b41d7ef42417ad865b95122', sha256: '702b0ce7413d05b9b9145c3bf868b3390da96ff6d9b199bd20c5f32fcfcd970d', len: 79785 },
  { seed: 43, caseId: '77efcda65dd04359ac9180fff034045c577f3ce1ff57186e3388a7c28f9e107d', resultId: '5cfbe025c0faadadf234690162e5b95938a7eedb1e11fd32dab2ec689c5f9b18', sha256: 'c094cbae913f273a04514d07194702c30a51b2b74a4eb2fe5f37534fcb965f98', len: 79785 },
  { seed: 44, caseId: '183946e7d228481d4f98452a292cee42b3fa29850d564ab2e52c8f752b31705b', resultId: '0a751844b5c42348b41cb4dabeccde557ea87fca735e602677ffba510f8fdd9a', sha256: 'c6cd8607c0ac90fc140e612e4c1b4db6a5ce9e0af406e85ee7f9eef39f186373', len: 79785 },
  { seed: 45, caseId: 'c077db0c3961f470f0e27737bd443f613c1bae26dff7522f9b8871f96a4eb022', resultId: 'd5a5926072f2328d422d6449c6b60a711697774821cbe0ab2882e6a34fa385e5', sha256: '51d10b944f289f6d364982260868af276cf3386f96d747df6a618a8a8e7311fe', len: 79785 },
  { seed: 46, caseId: '1f1e57e48629fcb6be45c176709d52c25ee2c76deb785cb61b47079df67a906c', resultId: '1c3dea18764f2423b4ca6fca5f766c3a8a238be43d6e40f23595c37b89e0592d', sha256: '560ed5f56361625101f19b0ca13c5a471217df0aa4d72690d44a057f552f87e0', len: 79785 },
  { seed: 47, caseId: 'ac6e35c464dcf1862836c96705b84e897ef67be30b7e75f3df6cc4e2e7c0eb25', resultId: '6b351a81fd43f1256ca774a74ef011affb5c547313377759ca48af2978bb755d', sha256: '97c5b5bce9cead7289ccdea0ee96d9203f77f3da4a5fd91165cd37544274af61', len: 79785 },
  { seed: 48, caseId: 'cadef6bd9a8e383596711650f2ccd0cc38c147d92e5525595284186a206917d9', resultId: 'e44cb11c23a8f6705b75fd6f5deeb4c226c31393d4c763b86980ed8f37e53c04', sha256: '98a4b222912a09d0c5a0eaa0336af15ef23ab7e3e25e1a98bed5a0c1213135e3', len: 79785 },
  { seed: 49, caseId: '3b11cda9c8cb5dc3db6f06a1f26148df66db1ee1a757a45c527474c21e32fd51', resultId: '28f7f3813f4bde07826eb8a9a800786ddb1ea9d7363e8110726c6fad2d7e9e69', sha256: 'dca83d44f0057467b44064538882ecccdfcc37bda0ed8831100b52b0b3e9d088', len: 79785 },
  { seed: 50, caseId: '223920ced74c08590125077f9e65cdb26c42d6365b523aae4d6e22ddbf03839e', resultId: '49238c2c6634dee63b2f724832eba88985b339c4f134a7d4963206d22c3a5361', sha256: 'dfc86a150c004c9cc44229f95344fadce0b1be4b0d136e6177fd037e2712bde2', len: 79785 },
  { seed: 51, caseId: 'ad04d0c6c72c281660edf69a373539fa46554dc4487c1a0a68abb6f40b1eb4ca', resultId: 'ac681fc5d1867a1745fa8203240beb67321b8d75378f6cbee2ba33f5977d96c1', sha256: '269f0b087da60918a70ee3f28f0a531db487bf19f7696615519b50a0e5c4e0a4', len: 79785 },
  { seed: 52, caseId: 'dd94db14824a8f7cdecf483deb3b71395f2b6405fc015758cb43de64a5fa8960', resultId: 'e909a780dae47ce6e8382c728485370ad1916ece62655c6f2cac792a06981916', sha256: '251454967b6976aa10c3a8dfa9dd2c926a408790c987d6b92ba6dd81a42f1541', len: 79785 },
  { seed: 53, caseId: '249841b226870d381deb772109f9ac0e06d24f501dfa4deac1e676d612117d32', resultId: 'f3a76ea88adff4fa7b0a107ce10b20229dd06b306ab908a3326df4e1305ef23e', sha256: '84dbba54900c2dac30aa555c8077ac293322788855fa820bd0e654bb110c621b', len: 79785 },
  { seed: 54, caseId: 'b1428ae951ce94dea908c6c45fc4bd5d7def8944ba74d4cae1e1fee5eccf6994', resultId: '214419a43a3cad3609d8b6aa81137554d51e90dfa71182cacc6290240832448e', sha256: 'e9a90c9ee505db6d272b8a545470ec6c9af471604d528dd637bfd0695eb8bf0e', len: 79785 },
  { seed: 55, caseId: 'c7e6c5c48cde68256222e064def4e5cacb2dc28b511934f5b5563831c55bf033', resultId: 'aae925f0de71c96a4117c49c78ef931713f8dc198cc3ee6b718f773402db779e', sha256: '954def4371a5e6d5020d45bbe2f5384f93ca952848b99d4c8de9ed11c93dcf9e', len: 79785 },
  { seed: 56, caseId: '6e169265ffe815cde692fad08bfe5e0f27e29301ba6388dbc838d8cbf0e213ae', resultId: '0ec5cc28d174121c105b66f4c94aa6efb58f325b52b294f87d4443b509445a77', sha256: 'd563dcce1bd7d7540cd1dde4fa0786e85423ac3ca6be9c5c79eff961ac3ffd06', len: 79785 },
  { seed: 57, caseId: 'ff37be2b61831f3ac244535751cdfbc89dc0f965a5a912470594587e3a59dc4e', resultId: '3c4f1e9414d718227bd06c4a6601776722e9206a6c9ada36c38ec645d7ec5bb9', sha256: 'b6745f2ca41affa0634e8da3baaac4a291a18beee323e9f2842274ddb4c74fa3', len: 79785 },
  { seed: 58, caseId: '44f0f710b65cf42f5d7465016bc427dc4d7f8d01ad29b385380255c8cf90b707', resultId: '5b2b9395a0d211a08691c6cd2ae9e68e1442b48af6041fd6bf969172070ba080', sha256: '37e9ca8092a2d620dafa17025674f78da2b4a097377bc59281a8aaeab7ec3710', len: 79785 },
  { seed: 59, caseId: '12742dd8edcf3037384ea307950bc8c2d473fdc16fc3154b82a5827d73937dc2', resultId: 'a3a8bcf31d1a2a445a38faf375277e23e110ea2ffd6fedce2639c50ad03a581c', sha256: '3d2bfb87fab289c05babbd927b5332900a86e45469dd60dac28162607253c1c5', len: 79785 },
  { seed: 60, caseId: 'de7dae5c2e134ebe588cf65dd06def5ae9f838e38856d9776c600f2252508dbe', resultId: 'caa646a0ead63afd6f0216d5748a8ebd8a55f157ef3a62cf075ec02e2a5efd50', sha256: 'b6fcba436fc42a0216390bf41f0c2e1ce6f1ca13b45f3256ad4fea79c23d45b9', len: 79785 },
  { seed: 61, caseId: '6240368133018e9be93e829adcbcff32898b92bd4815cde205503e7ce0744540', resultId: '852f3f1ac69485cbece5e01477124d62c0357883ed5b32a4c0be106dec025cae', sha256: '7eba8378f7290cc17cdcca35b2580cf11f11104d7b659962b7917a3b71e26e0b', len: 79785 },
  { seed: 62, caseId: 'b8deb6d7bbc0d9ddc687c16f43615fb32521e98900ac56945c8694d1e78d1920', resultId: '895df4e77784d8fb79d9eaf5e03a14d4f4a5d902c138d2051a1ff40ad2bd7c84', sha256: 'b71215395749aa6791cd6fcb9258ad2edb0cb970a3d3a1e4f4d017b83cf74d15', len: 79785 },
  { seed: 63, caseId: 'b9e47014d05d758ebbaca3c094168bd50453f215b598f53f76cb2e7f46185b5a', resultId: '1e663cff6d282a7d6d0511da6351878934156340d4599dd7f063969414138be2', sha256: 'b6972c25d72be951948249a0169e60969492b9eec01635c8af2d1173c634ec18', len: 79785 },
  { seed: 64, caseId: '43f14bab59459bca07a743f00928347d71e10dea92117e1ac10c541f03223265', resultId: '04dfb16fa317276fa630b112d91edccacc27c547dc2bb32942737f8f5ffcc88e', sha256: '6234932774ab4f15fce573c3a3089fd7ca7a5b96502d97d5c5b85b0037973a08', len: 79785 },
  { seed: 65, caseId: '1e8c039af730d9b7dfc2b654b158412a37f38f7e4b41727f1b44670061c4849b', resultId: 'daa85dcbae1a97c2f04ee09e42fe876e05bd72e3a796839655cf1be3d88bf2e4', sha256: 'a7131169dc43f679d811e099a9a7ed581b89fd2b003ec66c8ad78612c3162e30', len: 79785 },
  { seed: 66, caseId: 'fc01afa0bf2db72f1ac5705e8bcb6d98dfb82f8af8a86c28a667fa4f778864d2', resultId: 'd9555fd09bcea1eeff1c369051e505b94fc2e170b283b3ec99da620ef1e99c5f', sha256: '30177acb34d6c4d42cec97506c2cc429fd6eda15db3eaa315c3857a564c5dea1', len: 79785 },
  { seed: 67, caseId: 'e0c150f990f7ec78a8e613dc6a7411bd24fd5868f8b604780ec36d4db8cfd4fa', resultId: 'ac26b72704f831940205df3b852921ea35a0ef92ad7ce8dae876a951bf486858', sha256: '2b467cb43035866ab066afffda428f10f71fccdd7faf0312d5f9c86af181105a', len: 79785 },
  { seed: 68, caseId: 'd3c9be62db245784d6e333940994bb41d3630df3a8e3b9147f2411b0e36bcccf', resultId: 'daa2c6fab5e209940bff18ff1ed134c477f31fb28c6788372e547ea455fa0509', sha256: '56db24ffa22b966f05ad179bbb1edb9377e6546f34b40276cc1c314f2d136b3e', len: 79785 },
  { seed: 69, caseId: '4b5937a062adf11afcf76d65e843399391a0c827fd92cd96bb2804567225742b', resultId: '0f41638f34f824eb6c6bbfa70192dbc09a3ea17e1dec4044d4e12bc3fb68834c', sha256: '3af948560a5aab47ef76e1297d96bf3e63bbfe1f8b17c7a29fbab2bbca6a1787', len: 79785 },
  { seed: 70, caseId: '127a3139ba836b6914086629196cb32a44101602676ca7e13b811f227c5a177c', resultId: '5560a62230d50c7dce0d4f7ecf735217f2594438ca0602365760bf7af183ba9d', sha256: 'e678b1b88dbccc2e597d52a5ac34d2e2029fdbd08c301a4b23dfef7ae3a354d3', len: 79785 },
  { seed: 71, caseId: '3881ff2d33f962aa6e1bc124f2755cc74fdbbb0bb5e368c45d7adf2ed9e28e6a', resultId: '1c38aa28513d498cc65444ab2c66ba5fc5e19d9125a75267340bb61a39f4ae71', sha256: 'acb06c1e31e33d1cb31cd22dd50d6f333289292b68666853b88bfaa10e033226', len: 79785 },
  { seed: 72, caseId: '10f03d0668f69bc19987b0f7d155d36923d9c27076e2617019f690b7bef6f6ac', resultId: '25fd67ba3c909b4b7325f67b68706d24d3d1d16166094ed778e71871cbafc2bc', sha256: '0b4ed2ff90234610f0b7b57523170e6af658c38ae6d27648499bd98d8025a46e', len: 79785 },
  { seed: 73, caseId: 'ca09fd56d3c3989bbe90702ecca39c98f68f13fb874552686e855c3a70cbdf5a', resultId: '5607dd7f9cde6483cf7af0be4aaf1132f4c24b6e44c03980ab7d10fc34e53b12', sha256: '63fe307f58efb027b56429ba4598e6b6677d91a1ae31b28e11c48d53dfa43351', len: 79785 },
  { seed: 74, caseId: 'bec13277911ba3848ed4dd8f5899a4c2c790ae5399da9836321adabde3a315e9', resultId: '74dd0dab26572c716f3e1f9ded3da2b5c03fde4ed10b5c608a76a3bbbb26e4f8', sha256: '99e942ba313e580c485cc9038964ed4207fac7c49a1c9b1a264b4f7e56ff7119', len: 79785 },
  { seed: 75, caseId: '2e8fc537a428307c45af728d2bce88cf8f0b01ce8055098dc2fd15350dfb36c4', resultId: 'e9d2e858bcfbd193f4bd33c85c11650051b4495a47c9366bfeebe0b1869657bb', sha256: '9fcc11f6d6c165564aa2b83c48fb11887edfec5f25a4d83a6270c2a059c4eaf0', len: 79785 },
  { seed: 76, caseId: '3d3a72ced395db15d9ceb802858c66fb5fea2b8adc3541644b45ff5bbd39a516', resultId: 'f3f618558fd5b066b69a80b4174d6164b22931dda76a3f2ded688cc93a72992a', sha256: '9789ff240682411ef96a502b94fd74e80b474b0b6af92f7c69e529df8458a0eb', len: 79785 },
  { seed: 77, caseId: 'c81a5db2a7de41aefa6cf03cfc29f022a3e679f549d51d3309c8aeec84074721', resultId: 'd978a92ac4db8f1a0c8fc7e0cca215961d175d4cf2164e97669a823c7f5238a0', sha256: '789c913b81c51fc840ab76961539b448b921f64da30e679d588653359224a2c8', len: 79785 },
  { seed: 78, caseId: 'c15db0e9561ffe86922b4ef26aa82aa2f812754bd1e123d2441ffb59c9443ea6', resultId: '6aff5d0e1f2acf81423954bbde0df3da708bc3cdd01f7bd4e57398f6b7073204', sha256: 'b2593d4e21b18f39094e6311aa2b5ae8f0cb012499bb41be78874448c2594658', len: 79785 },
  { seed: 79, caseId: 'bbbc2e10548ada8cf13e91cf8a7e09516d20993dcbc6068c26a982d6a5e8032d', resultId: 'ebb06510b6e8637eaade3514f8bf08b12a566ae937004dd1858838cfb00e5b21', sha256: 'afc54e255e5e08e41732cd084ddac444fa3de494409414a32af095003c7ebea8', len: 79785 },
  { seed: 80, caseId: '353264e47e37b2688b1e16e67b79057cc4836176090f77246652c9c4889e3660', resultId: '8c74ac8992556b89f6ec81bbfe3d4eaaefea7216df4c73e63a5be9dd9063c049', sha256: 'a84d4a003ff1f93a98e55917ac32926f85c8b9b04d3d934d8067df345ea4387d', len: 79785 },
  { seed: 81, caseId: '379c2931770cacbef524efef7745fe15bba560b1e60b38d82990660c583dcd4c', resultId: '3905ac2b6d54d790cd3e5a83a71717e670c821d4169825878487b3bf9f4c630a', sha256: '67807d39ee4d89a9440bd30838f12d6df58d8714836e2f0e23ae2a2657fb7142', len: 79785 },
  { seed: 82, caseId: '537a40405458ca7bdc760619b043aa4b73056a0a9cf94972cbb204a7ffb00bf4', resultId: 'acb8cc94e88c168084a21aaa7e72222e6c532fad43061e544a7e82198b266fa9', sha256: 'c582174f188626329d19db23009a0077dddfc676bcfc332fb66cb0fe7474e11c', len: 79785 },
  { seed: 83, caseId: '0fba2ba8b5918eed5f32434e815b03234af7b2eef4bf0a7789267b6612043444', resultId: 'cc3d0fba70a5b576aa6323d25b54274e2193fa375b52850173e6cdc8496da585', sha256: '402fa59f795c0f9b256c80d082c9381fa5f5c2dad76e6abda6ffeea161cffb8d', len: 79785 },
  { seed: 84, caseId: '6073e25c065f1fbd708993f60c1195f8b7461bc1983925b93a5708f7ce7ac19f', resultId: 'dbbada2e080cbf5df526cb38f68ffbb4a7d435d12a8ff65a4f634725c34a3794', sha256: 'f35558eff77a910ca17ef65952e58bd77edd3de5e13b4238c131348270d3fcba', len: 79785 },
  { seed: 85, caseId: 'e31078d1a38cacacab4527c61d3e89e0521b1baef1602b6f44eb9c9c27274052', resultId: 'cf58a75d7cec49190c4cb0d30641f2ea48ae2faf06221d7f9f8af2a8085b76f4', sha256: '8c31c968cf6b49fd86404d2ef21c4ed26c4444662ad2f3cb793ed3fe1057957c', len: 79785 },
  { seed: 86, caseId: '6365332ab133a5ab00396729addac4913f96c3e4092fb1e1f50265deb8022ba7', resultId: '5066bc33619b28df607c48a938e457eff7865db2b2b6f2a88c1db14cd4b723cf', sha256: 'c584227691e3c61f40376db04af170e4fb709422560bfeab2cfaf1612e0d756e', len: 79785 },
  { seed: 87, caseId: 'eb69f888147fff0b8e237fa4e21154eb9e4ee1e6e5748a90f20fad7bd239be8f', resultId: '894dbd42d0554505d75237fc2a8311bb3ca806b0f49796ac3416ff17583fff12', sha256: 'd319a2b13183d592dbdd944ae623872a742325c0a1f5728a27a6781d61c3c827', len: 79785 },
  { seed: 88, caseId: '0fe2186d82efbfd4bd88f901ffeea5a3b4fa35783f2b954255dfd89494071a6b', resultId: '224050b4ee7ca311702c2b68d2c0be9c2709839211161ccff221af15972471a9', sha256: '27f6dfb218a2afc50167e837fb1552bcd75ce657be0240915df614e57b7f2479', len: 79785 },
  { seed: 89, caseId: '89922aa138f0ac76f64e5901f80b77402dfe5d8480848d23ba03d9b4aa86e741', resultId: 'cd978f746f12ffd59ea822fe06f241af865026e8e6e416e89894828fc1c413eb', sha256: 'aaa0dee935434a2559c3f1ecda15942dd266beac0a857bc951c5e277777a6083', len: 79785 },
  { seed: 90, caseId: '1e974e9315b3864d62c957adda905857233f0fb3fca664679d8916fc35acd089', resultId: 'b19d0af8b31ddf6198bb0ac4b31eea9c32cde116c464e5149bff182a41638887', sha256: 'b05318bda5afbee34870670258fc5517e9211f028fda19831124422ae6cf019e', len: 79785 },
  { seed: 91, caseId: '3957ca5d00421eb051950bf9bd600bb638783e2903643ffc9ceac87253a540bd', resultId: '53be0853d852f189d22734dfd55357436b1df9e91756708c7b4cf7c0fd79bb01', sha256: 'a62b5f7fce30b76aaca541c486f1f989e380bcf75edc57febec13185b02f0640', len: 79785 },
]

export const ROBUST_F3A: CampaignCatalog = {
  campaignId: 'robust-f3a',
  experiment: 'EXP-F3a',
  profile: 'robust-f3a',
  planId: 'c40caf859cdadc7eb986e083582983b06536c64ba4ef7acc56fc73d9a00bdca3',
  verdictLevel: 2,
  verdictLevelName: 'ROBUST',
  nSeeds: 50,
  attemptsPerVariant: 3,
  base: 'campaigns/robust-f3a',
  manifestUrl: 'campaigns/robust-f3a/campaign-manifest.json',
  // The two certified aggregate members + their full certified tuple (authority for the Wall's gauge validation,
  // W5 F1). test_id ⇄ kind is fixed by the certifier: NEES is test_id 2, NIS is test_id 3
  // (EXP-F3a-robust.json.statistical); member_count = 2. statistic/pass/dof/alpha/sidedness/bounds are the
  // certifier-recomputed values, seed-deterministic, echoed from the vendored manifest and pinned HERE so a
  // fetched deviation is rejected. These equal publication.test.ts's independent PINNED_GAUGES literals (the CI
  // drift gate proves catalog ⇄ literals ⇄ vendored manifest agree — a coordinated forgery cannot move all three).
  stat: {
    schemaPrefix: 'campaign-manifest-sidecar/v0',
    verdictSchemaVersion: 2,
    members: [
      { testId: 2, kind: 'CHI2_NEES', statistic: '212.57017224319395', pass: true, dof: 200, alphaPpm: 25000, sidedness: 'TWO', loBits: '4063bc0da9d80e2d', hiBits: '406eef7b64db220a' },
      { testId: 3, kind: 'CHI2_NIS',  statistic: '93.21421605417723', pass: true, dof: 100, alphaPpm: 25000, sidedness: 'TWO', loBits: '4051c0e6fdc9bc29', hiBits: '4060caeecd55fdf4' },
    ],
  },
  seeds: ROBUST_F3A_SEEDS,
}

// The pinned campaign library, keyed by campaign id (the runCatalog RUN_CATALOG idiom, one entry today).
export const CAMPAIGN_CATALOG: Readonly<Record<string, CampaignCatalog>> = {
  'robust-f3a': ROBUST_F3A,
}

// The canonical seed-id LIST for a campaign, in seed-number (catalog) order — the ONE derivation of the per-seed
// canonical decimal id (String(seed)) shared by every campaign-store seeder. The Certification Wall's store is
// seeded from THIS list at the OPEN ACTION (App's onOpenWall, before the modal mounts) and re-inited from it on a
// re-run (wallView's startVerifyAll); both call this ONE function on the SAME catalog, so App and the Wall can
// never seed a divergent id set — no duplicated `cat.seeds.map(String)` to drift apart. (buildCampaignJobs derives
// the same ids when it builds the verify jobs; it also needs the seed number + campaignId, so it maps the pins
// directly — the id spelling is "String(seed)" in both, one contract.)
export function campaignSeedIds(cat: CampaignCatalog): readonly string[] {
  return cat.seeds.map(s => String(s.seed))
}

// A per-seed Map keyed by the CANONICAL decimal seed id (String(seed)). A Map (not a plain object) so a lookup
// key can never collide with a prototype member — the campaign sibling of runCatalog's Object.hasOwn discipline.
const SEED_INDEX: ReadonlyMap<string, ReadonlyMap<string, CampaignSeedPin>> = new Map(
  Object.entries(CAMPAIGN_CATALOG).map(([id, cat]) => [id, new Map(cat.seeds.map(s => [String(s.seed), s]))]),
)

// A conforming seed id is a CANONICAL decimal string: a single leading digit 1-9 then digits (or a lone '0').
// This is the campaign twin of runCatalog's RUN_ID_RE — it rejects anything that could redirect a fetch (a
// slash, '..', a scheme) or that is a non-canonical spelling ('042', ' 42', '+42') the pinned base would then
// interpolate into a path. Every pinned seed (42..91) is canonical decimal, so all resolve; nothing else does.
const SEED_ID_RE = /^(?:0|[1-9][0-9]*)$/

// F5/F8 precedent — prototype-shaped ids that could otherwise slip through a naive lookup. None CONFORM to
// SEED_ID_RE (they carry letters), so the grammar already rejects them; the Map lookup is prototype-safe on its
// own too. We keep the denylist as an explicit belt-and-suspenders mirror of resolveLoadPlan, so the contract
// reads identically: EVERY prototype-shaped id resolves to NO pin and NO fetch.
const PROTOTYPE_DENYLIST: ReadonlySet<string> = new Set([
  'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', '__proto__',
])

export function getCampaign(campaignId: string): CampaignCatalog | null {
  if (!Object.hasOwn(CAMPAIGN_CATALOG, campaignId)) return null
  return CAMPAIGN_CATALOG[campaignId]!
}

// Resolve a seed id to its pinned {caseId, resultId, sha256, len} — from the IN-BUNDLE catalog, never from the
// fetched manifest. Returns null for a non-conforming / prototype-shaped / unknown seed id (grammar-first, then
// denylist, then Map lookup — the resolveLoadPlan order), so a bad id yields NO pin and NO fetch.
export function resolveCampaignSeed(campaignId: string, seedId: string): CampaignSeedPin | null {
  if (!SEED_ID_RE.test(seedId)) return null
  if (PROTOTYPE_DENYLIST.has(seedId)) return null
  return SEED_INDEX.get(campaignId)?.get(seedId) ?? null
}

// The base-relative load PATH for a seed's bytes — DERIVED from the pinned base and the seed number, NEVER from a
// manifest field: `${cat.base}/${seed}/bundle.det`. This is where the H1 base-swap is closed at the source: a
// tampered manifest cannot point a seed at another seed's (or another campaign's) bytes. It is base-RELATIVE (no
// leading slash) so it composes onto the resolved absolute app base via URL semantics (campaignBundleUrl).
export function campaignBundlePath(cat: CampaignCatalog, seed: CampaignSeedPin): string {
  return `${cat.base}/${seed.seed}/bundle.det`
}

// Resolve the app's deploy base to an ABSOLUTE base URL — on the MAIN THREAD, before the worker is initialised.
// `base` is Vite's `import.meta.env.BASE_URL`: '/' at root, '/swarm-observatory/' under Pages, and — for a
// RELATIVE Vite base — '' or './'. `baseURI` is `document.baseURI` in the browser (a test passes an explicit
// fake — this fn takes NO DOM). Why here and not in the worker (F2): a worker's relative fetch resolves against
// the WORKER SCRIPT url (/assets/…), so the worker cannot itself interpret a relative ('' / './') Vite base; the
// main thread resolves it against the document base and posts the ABSOLUTE result. `base || '.'` maps an empty
// base to the current DIRECTORY — `new URL('', baseURI)` resolves to the document URL itself (index.html and
// all), not its directory. The pathname is then normalised — duplicate slashes collapsed, exactly one trailing
// slash — so the worker's URL join is unambiguous regardless of a mis-slashed base.
export function resolveAppBase(base: string, baseURI: string): string {
  const abs = new URL(base || '.', baseURI)
  abs.pathname = `${abs.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '')}/`
  return abs.href
}

// The worker-side JOIN: the ABSOLUTE seed-bytes URL, from the resolved absolute base (resolveAppBase, posted at
// init) and the base-relative seed path, via URL semantics — NOT string concatenation. A relative Vite base or a
// stray double slash makes concatenation resolve wrong (or, from the worker, resolve against /assets/); `new URL`
// composes correctly and is the single join the worker uses.
export function campaignBundleUrl(cat: CampaignCatalog, seed: CampaignSeedPin, absoluteBase: string): string {
  return new URL(campaignBundlePath(cat, seed), absoluteBase).href
}
