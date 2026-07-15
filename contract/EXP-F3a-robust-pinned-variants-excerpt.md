# SANCTIONED EXCERPT — EXP-F3a ROBUST `pinned_variants` (v9 per-seed identities)

**Purpose:** the certified per-seed `case_id` / `result_id` table behind the Observatory's
"re-verify a robust-campaign bundle in your browser" surface. For each vendored
`f3a_robust_seed<NN>/` fixture, `bundle-verify <attempt_dir>` recomputes a `result_id`; this
table is what that recomputed id (and the manifest's `case_id`) must equal. Read-only excerpt;
nothing in the frozen contract moves.

**Sanction & provenance (verify before shipping the lens):**
- Normative source: `roadmap/evidence/EXP-F3a-robust.json` (the CI-gate-anchored v9 pins record —
  the `exp-f3a-robust` gate re-earns every value here from a real clean-provenance run each commit;
  no static oracle). Git blob hash of the source this excerpt was cut from:
  `dd68b8f8d8396b34eaf54ee349671b684ad82e32` — re-verify with
  `git hash-object roadmap/evidence/EXP-F3a-robust.json` at your vendored Certus commit before shipping.
- The per-seed `case_id`/`result_id` are the AUTHORITY (`check_citation.py` re-earns them against a
  live run). They are build-INDEPENDENT under a fixed identity: they re-derive from the emitted
  sufficient statistics + the pinned closed-form truth, NOT from the build fingerprint. A toolchain
  or `Cargo.lock` bump, or a schema-registry bump, re-pins them (D-002).
- **This excerpt is NON-AUTHORITATIVE** (the hashed source record is the authority) and carries a
  staleness boundary: valid as of Certus `main` @ `5ac32c4` (event/state schema **v9/s4**; F6b k=8
  bump merged). If the blob hash above ever mismatches, re-cut the excerpt; do not patch it in place.

## Identity closure (what these pins fold)

- `toolchain_id`   = `rustc-1.93.0`
- `cargo_lock_hash` = `ec4455d0e36a109b9eac61edfa3b01b738bf9f1102918cb57f45e00a5de3ee7a`
- `pinned_live.plan_id` = `c40caf859cdadc7eb986e083582983b06536c64ba4ef7acc56fc73d9a00bdca3`
- `event_schema_version` = 9  ·  `state_schema_version` = 4

## Conformance attestation (build-independent subset)

- `gates_passed` = 31  (0x1F: COUPLING_COMPILE_FAIL,
  COUPLING_RESOLVER_DESYNC, CAPABILITY_NONINTERFERENCE, OFFLINE_REVERIFY, CRASH_AT_PUBLICATION)
- `d2_status` = 1  (Gated per D-014 — cross-machine FP identity is honestly NOT claimed;
  see the vendored `EXP-F3a-D2-gating-note.FIXTURE.md`)
- `gating_note_hash` = `a7da0b75a7db8fb5cf5bf7fe0af62d10c0ebeb270d044d7ba1a705630f88eac4`
  (section-4.4 framing of `roadmap/evidence/EXP-F3a-D2-gating-note.md`; reproduces from the vendored gating-note copy)

## `pinned_variants` — 50 seeds (42..=91)

The 5 seeds marked **DROP** ship as `f3a_robust_seed<NN>/` fixtures in this drop (the seeds-42..46
starter batch). The remaining 45 are listed for completeness / follow-up acquisition; their bundles
are not yet vendored.

| seed | in drop | case_id | result_id |
|---|---|---|---|
| 42 | **DROP** | `0b82614b372b0f9e90d64f32a3c8b04ed76563ceee13837c19bd9955ca76073a` | `9130689461912599b43cae77ba8cb6fc85ba032c0b41d7ef42417ad865b95122` |
| 43 | **DROP** | `77efcda65dd04359ac9180fff034045c577f3ce1ff57186e3388a7c28f9e107d` | `5cfbe025c0faadadf234690162e5b95938a7eedb1e11fd32dab2ec689c5f9b18` |
| 44 | **DROP** | `183946e7d228481d4f98452a292cee42b3fa29850d564ab2e52c8f752b31705b` | `0a751844b5c42348b41cb4dabeccde557ea87fca735e602677ffba510f8fdd9a` |
| 45 | **DROP** | `c077db0c3961f470f0e27737bd443f613c1bae26dff7522f9b8871f96a4eb022` | `d5a5926072f2328d422d6449c6b60a711697774821cbe0ab2882e6a34fa385e5` |
| 46 | **DROP** | `1f1e57e48629fcb6be45c176709d52c25ee2c76deb785cb61b47079df67a906c` | `1c3dea18764f2423b4ca6fca5f766c3a8a238be43d6e40f23595c37b89e0592d` |
| 47 |  | `ac6e35c464dcf1862836c96705b84e897ef67be30b7e75f3df6cc4e2e7c0eb25` | `6b351a81fd43f1256ca774a74ef011affb5c547313377759ca48af2978bb755d` |
| 48 |  | `cadef6bd9a8e383596711650f2ccd0cc38c147d92e5525595284186a206917d9` | `e44cb11c23a8f6705b75fd6f5deeb4c226c31393d4c763b86980ed8f37e53c04` |
| 49 |  | `3b11cda9c8cb5dc3db6f06a1f26148df66db1ee1a757a45c527474c21e32fd51` | `28f7f3813f4bde07826eb8a9a800786ddb1ea9d7363e8110726c6fad2d7e9e69` |
| 50 |  | `223920ced74c08590125077f9e65cdb26c42d6365b523aae4d6e22ddbf03839e` | `49238c2c6634dee63b2f724832eba88985b339c4f134a7d4963206d22c3a5361` |
| 51 |  | `ad04d0c6c72c281660edf69a373539fa46554dc4487c1a0a68abb6f40b1eb4ca` | `ac681fc5d1867a1745fa8203240beb67321b8d75378f6cbee2ba33f5977d96c1` |
| 52 |  | `dd94db14824a8f7cdecf483deb3b71395f2b6405fc015758cb43de64a5fa8960` | `e909a780dae47ce6e8382c728485370ad1916ece62655c6f2cac792a06981916` |
| 53 |  | `249841b226870d381deb772109f9ac0e06d24f501dfa4deac1e676d612117d32` | `f3a76ea88adff4fa7b0a107ce10b20229dd06b306ab908a3326df4e1305ef23e` |
| 54 |  | `b1428ae951ce94dea908c6c45fc4bd5d7def8944ba74d4cae1e1fee5eccf6994` | `214419a43a3cad3609d8b6aa81137554d51e90dfa71182cacc6290240832448e` |
| 55 |  | `c7e6c5c48cde68256222e064def4e5cacb2dc28b511934f5b5563831c55bf033` | `aae925f0de71c96a4117c49c78ef931713f8dc198cc3ee6b718f773402db779e` |
| 56 |  | `6e169265ffe815cde692fad08bfe5e0f27e29301ba6388dbc838d8cbf0e213ae` | `0ec5cc28d174121c105b66f4c94aa6efb58f325b52b294f87d4443b509445a77` |
| 57 |  | `ff37be2b61831f3ac244535751cdfbc89dc0f965a5a912470594587e3a59dc4e` | `3c4f1e9414d718227bd06c4a6601776722e9206a6c9ada36c38ec645d7ec5bb9` |
| 58 |  | `44f0f710b65cf42f5d7465016bc427dc4d7f8d01ad29b385380255c8cf90b707` | `5b2b9395a0d211a08691c6cd2ae9e68e1442b48af6041fd6bf969172070ba080` |
| 59 |  | `12742dd8edcf3037384ea307950bc8c2d473fdc16fc3154b82a5827d73937dc2` | `a3a8bcf31d1a2a445a38faf375277e23e110ea2ffd6fedce2639c50ad03a581c` |
| 60 |  | `de7dae5c2e134ebe588cf65dd06def5ae9f838e38856d9776c600f2252508dbe` | `caa646a0ead63afd6f0216d5748a8ebd8a55f157ef3a62cf075ec02e2a5efd50` |
| 61 |  | `6240368133018e9be93e829adcbcff32898b92bd4815cde205503e7ce0744540` | `852f3f1ac69485cbece5e01477124d62c0357883ed5b32a4c0be106dec025cae` |
| 62 |  | `b8deb6d7bbc0d9ddc687c16f43615fb32521e98900ac56945c8694d1e78d1920` | `895df4e77784d8fb79d9eaf5e03a14d4f4a5d902c138d2051a1ff40ad2bd7c84` |
| 63 |  | `b9e47014d05d758ebbaca3c094168bd50453f215b598f53f76cb2e7f46185b5a` | `1e663cff6d282a7d6d0511da6351878934156340d4599dd7f063969414138be2` |
| 64 |  | `43f14bab59459bca07a743f00928347d71e10dea92117e1ac10c541f03223265` | `04dfb16fa317276fa630b112d91edccacc27c547dc2bb32942737f8f5ffcc88e` |
| 65 |  | `1e8c039af730d9b7dfc2b654b158412a37f38f7e4b41727f1b44670061c4849b` | `daa85dcbae1a97c2f04ee09e42fe876e05bd72e3a796839655cf1be3d88bf2e4` |
| 66 |  | `fc01afa0bf2db72f1ac5705e8bcb6d98dfb82f8af8a86c28a667fa4f778864d2` | `d9555fd09bcea1eeff1c369051e505b94fc2e170b283b3ec99da620ef1e99c5f` |
| 67 |  | `e0c150f990f7ec78a8e613dc6a7411bd24fd5868f8b604780ec36d4db8cfd4fa` | `ac26b72704f831940205df3b852921ea35a0ef92ad7ce8dae876a951bf486858` |
| 68 |  | `d3c9be62db245784d6e333940994bb41d3630df3a8e3b9147f2411b0e36bcccf` | `daa2c6fab5e209940bff18ff1ed134c477f31fb28c6788372e547ea455fa0509` |
| 69 |  | `4b5937a062adf11afcf76d65e843399391a0c827fd92cd96bb2804567225742b` | `0f41638f34f824eb6c6bbfa70192dbc09a3ea17e1dec4044d4e12bc3fb68834c` |
| 70 |  | `127a3139ba836b6914086629196cb32a44101602676ca7e13b811f227c5a177c` | `5560a62230d50c7dce0d4f7ecf735217f2594438ca0602365760bf7af183ba9d` |
| 71 |  | `3881ff2d33f962aa6e1bc124f2755cc74fdbbb0bb5e368c45d7adf2ed9e28e6a` | `1c38aa28513d498cc65444ab2c66ba5fc5e19d9125a75267340bb61a39f4ae71` |
| 72 |  | `10f03d0668f69bc19987b0f7d155d36923d9c27076e2617019f690b7bef6f6ac` | `25fd67ba3c909b4b7325f67b68706d24d3d1d16166094ed778e71871cbafc2bc` |
| 73 |  | `ca09fd56d3c3989bbe90702ecca39c98f68f13fb874552686e855c3a70cbdf5a` | `5607dd7f9cde6483cf7af0be4aaf1132f4c24b6e44c03980ab7d10fc34e53b12` |
| 74 |  | `bec13277911ba3848ed4dd8f5899a4c2c790ae5399da9836321adabde3a315e9` | `74dd0dab26572c716f3e1f9ded3da2b5c03fde4ed10b5c608a76a3bbbb26e4f8` |
| 75 |  | `2e8fc537a428307c45af728d2bce88cf8f0b01ce8055098dc2fd15350dfb36c4` | `e9d2e858bcfbd193f4bd33c85c11650051b4495a47c9366bfeebe0b1869657bb` |
| 76 |  | `3d3a72ced395db15d9ceb802858c66fb5fea2b8adc3541644b45ff5bbd39a516` | `f3f618558fd5b066b69a80b4174d6164b22931dda76a3f2ded688cc93a72992a` |
| 77 |  | `c81a5db2a7de41aefa6cf03cfc29f022a3e679f549d51d3309c8aeec84074721` | `d978a92ac4db8f1a0c8fc7e0cca215961d175d4cf2164e97669a823c7f5238a0` |
| 78 |  | `c15db0e9561ffe86922b4ef26aa82aa2f812754bd1e123d2441ffb59c9443ea6` | `6aff5d0e1f2acf81423954bbde0df3da708bc3cdd01f7bd4e57398f6b7073204` |
| 79 |  | `bbbc2e10548ada8cf13e91cf8a7e09516d20993dcbc6068c26a982d6a5e8032d` | `ebb06510b6e8637eaade3514f8bf08b12a566ae937004dd1858838cfb00e5b21` |
| 80 |  | `353264e47e37b2688b1e16e67b79057cc4836176090f77246652c9c4889e3660` | `8c74ac8992556b89f6ec81bbfe3d4eaaefea7216df4c73e63a5be9dd9063c049` |
| 81 |  | `379c2931770cacbef524efef7745fe15bba560b1e60b38d82990660c583dcd4c` | `3905ac2b6d54d790cd3e5a83a71717e670c821d4169825878487b3bf9f4c630a` |
| 82 |  | `537a40405458ca7bdc760619b043aa4b73056a0a9cf94972cbb204a7ffb00bf4` | `acb8cc94e88c168084a21aaa7e72222e6c532fad43061e544a7e82198b266fa9` |
| 83 |  | `0fba2ba8b5918eed5f32434e815b03234af7b2eef4bf0a7789267b6612043444` | `cc3d0fba70a5b576aa6323d25b54274e2193fa375b52850173e6cdc8496da585` |
| 84 |  | `6073e25c065f1fbd708993f60c1195f8b7461bc1983925b93a5708f7ce7ac19f` | `dbbada2e080cbf5df526cb38f68ffbb4a7d435d12a8ff65a4f634725c34a3794` |
| 85 |  | `e31078d1a38cacacab4527c61d3e89e0521b1baef1602b6f44eb9c9c27274052` | `cf58a75d7cec49190c4cb0d30641f2ea48ae2faf06221d7f9f8af2a8085b76f4` |
| 86 |  | `6365332ab133a5ab00396729addac4913f96c3e4092fb1e1f50265deb8022ba7` | `5066bc33619b28df607c48a938e457eff7865db2b2b6f2a88c1db14cd4b723cf` |
| 87 |  | `eb69f888147fff0b8e237fa4e21154eb9e4ee1e6e5748a90f20fad7bd239be8f` | `894dbd42d0554505d75237fc2a8311bb3ca806b0f49796ac3416ff17583fff12` |
| 88 |  | `0fe2186d82efbfd4bd88f901ffeea5a3b4fa35783f2b954255dfd89494071a6b` | `224050b4ee7ca311702c2b68d2c0be9c2709839211161ccff221af15972471a9` |
| 89 |  | `89922aa138f0ac76f64e5901f80b77402dfe5d8480848d23ba03d9b4aa86e741` | `cd978f746f12ffd59ea822fe06f241af865026e8e6e416e89894828fc1c413eb` |
| 90 |  | `1e974e9315b3864d62c957adda905857233f0fb3fca664679d8916fc35acd089` | `b19d0af8b31ddf6198bb0ac4b31eea9c32cde116c464e5149bff182a41638887` |
| 91 |  | `3957ca5d00421eb051950bf9bd600bb638783e2903643ffc9ceac87253a540bd` | `53be0853d852f189d22734dfd55357436b1df9e91756708c7b4cf7c0fd79bb01` |

> `bundle_det_sha256` / `bundle_det_len` are NOT in this record: they are build-BOUND digests (D-002),
> re-derived per build and never pinned. For the 5 dropped seeds they are carried in each
> `f3a_robust_seed<NN>/IDENTITY.json`, and in the Certus consumer-facing campaign-manifest sidecar
> (`roadmap/evidence/campaigns/EXP-F3a-robust-campaign-manifest.json`).

---
*Cut 2026-07-09 from Certus `main` @ `5ac32c4`
(`5ac32c40432a54ffdd81f1ea94b40a09c1f63d06`) by the Certus-side session (owner-relayed request).
Supersedes the stale `EXP-F3a-robust-campaign-manifest.FIXTURE.json` per-seed ids (plan_id
`636c4b4c…`, cut from the pre-merge `exp-f6a-bump @ bdb6feb`), which do NOT reproduce at v9 main.*
