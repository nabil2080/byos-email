# Notes: Favorite Star, List-First Desktop, and Animated Phone Drawer — Report

## What was built

The Notes module no longer exposes the pin system. The pin button was removed from the editor header and the pin marker was removed from list rows; the favorite star now sits in the slot the pin used to occupy, first in the note action group, and behaves like the mail star (filled amber when set, `aria-pressed`, tooltip `Add to favorites` / `Remove from favorites`). The list is now a single flat, mail-like list with no PINNED / ALL NOTES grouping and no pin-first sorting. On desktop the module opens on the note list alone, exactly like the mail list: the editor pane is not mounted until a note is clicked or created, and selecting a note shrinks the list to a 320–350px column and mounts the editor. On the phone viewport the navigation sidebar is now an animated off-canvas drawer: it stays mounted, slides via the CSS `translate` property over 200ms with a `cubic-bezier(0.2,0,0,1)` curve, fades a dimmed backdrop, and slides back out on backdrop click, Escape, or navigation selection. The store data model is untouched: `isPinned` and `togglePinNote` remain in `notesStore.ts` (and in sync payloads) so encrypted payloads and stored notes keep round-tripping; only the UI stopped using them, matching how the note color system was retired earlier.

## Files edited

| File | Reason |
|------|--------|
| `apps/webmail/src/components/notes/NotesEditor.tsx` | Removed the `onTogglePin` prop and pin button; the favorite star is now the first note action with `aria-pressed`. |
| `apps/webmail/src/components/notes/NotesList.tsx` | Removed pin-first sorting and PINNED / ALL NOTES group headers; list is a flat `<For>` whose width is controlled by its wrapper. |
| `apps/webmail/src/components/notes/NotesListItem.tsx` | Removed the `onTogglePin` prop and pin indicator; the favorite star is the only status marker. |
| `apps/webmail/src/components/notes/NotesView.tsx` | Dropped `togglePinNote`; editor mounts only when a note is selected; list is full-width alone and a 320–350px column when split; sidebar/backdrop are animated and always mounted; new effect returns the phone view to the list when no note is selected. |
| `tests/browser/notes_mobile_drawer.mjs` | **New** 19-check suite covering list-first desktop, editor-on-click, drawer geometry, animation CSS, frame-by-frame close interpolation, all dismissal paths, desktop split, and DevTools state. |
| `tests/browser/verify_notes_ui_consistency.mjs` | Replaced the pin-icon and pin-toggle checks with pin-retired + favorite-first + favorite-toggle checks; updated the toolbar mapping/tooltips and header doc. |
| `tests/browser/verify_notes_three_pane_redesign.mjs` | STEP 2 now asserts the list-first desktop state; the three-pane split moved to after note creation (`LAYOUT_02`); STEP 5 drops the pin click and asserts the pin button is absent; mobile pane detection uses computed drawer visibility; STEP 5C now deterministically re-opens the created note and normalizes its mode before the checklist assertion. |
| `tests/browser/test_notes_wysiwyg_and_title_wrapping.mjs` | Mobile drawer detection now reads computed `visibility`/`translate` instead of `offsetParent`, because the drawer is kept mounted off-canvas. |
| `docs/notes_pin_favorite_list_first_report.md` | This report. |

`apps/webmail/src/components/notes/notesStore.ts` was **not** edited. `isPinned` / `togglePinNote` are intentionally retained as data-model and store APIs (same approach as the previously retired note color UI), so existing encrypted payloads, sync frames, and store tests keep passing.

## Raw evidence

### 1. No pin UI remains (source scan)

```
== UI components (tsx) pin references ==

Path                                                                LineNumber Line                                                          
----                                                                ---------- ----                                                          
F:\Codex\byos-email\apps\webmail\src\components\notes\NotesList.tsx        238           {/* Flat note list — no pinned/unpinned sections */}



== notesStore.ts (retained data model + store function) ==

LineNumber Line                                                                                                               
---------- ----                                                                                                               
        42   isPinned: boolean;                                                                                               
      1155       isPinned: true,                                                                                              
      1175       isPinned: false,                                                                                             
      1319   isPinned: boolean = false,                                                                                       
      1338     isPinned,                                                                                                      
      1471     note.isPinned = false; // unpin when binned                                                                    
      1548   note.isPinned = false;                                                                                           
      1563 export function togglePinNote(mailboxId: string | undefined, id: string, mailboxKey?: Uint8Array | null): boolean {
      1568   note.isPinned = !note.isPinned;
```

### 2. Typecheck (`tsc --noEmit`)

Exit code 2. Every reported error is in the pre-existing `src/offline.test.ts` file that this task never touched; no notes component or test has a type error.

```
src/offline.test.ts(460,14): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
  Type 'undefined' is not assignable to type 'boolean'.
src/offline.test.ts(619,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(620,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(621,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(622,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(623,28): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(624,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(625,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(626,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(626,14): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
  Type 'undefined' is not assignable to type 'boolean'.
src/offline.test.ts(861,14): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
  Type 'undefined' is not assignable to type 'boolean'.
```

### 3. Browser suite — mobile drawer, animation, list-first layout, editor-on-click

Command: `node tests/browser/notes_mobile_drawer.mjs` (exit 0, 19/19 checks).

```
==============================================================================
  BYOS NOTES: MOBILE DRAWER, ANIMATION & LIST-FIRST LAYOUT VERIFICATION
==============================================================================

--- [STEP 1] Login as Alice ---
  [PASS] [AUTH] Login as Alice succeeded
         Details: account-chip-selector mounted

--- [STEP 2] Open Notes module (desktop, nothing selected) ---
  [PASS] [DESKTOP_SIDEBAR_INLINE] Desktop sidebar is the 256px in-flow pane
         Details: width=256px position=static
  [PASS] [DESKTOP_NO_BACKDROP] Desktop renders no mobile backdrop
         Details: backdropDisplay=none
  [PASS] [DESKTOP_LIST_ONLY] Desktop shows the list only until a note is clicked
         Details: listWidth=1122px editorMounted=false

--- [STEP 3] Resize to 375px phone viewport ---
  [PASS] [MOBILE_LIST_FIRST] Notes opens on the note list, not the navigation sidebar
         Details: listVisible=true shellOpen=false transformX=-100
  [PASS] [MOBILE_NO_HSCROLL] No horizontal scroll at 375px
         Details: doc=375 body=375 viewport=375
  [PASS] [MOBILE_DRAWER_ANIMATION] Drawer slides (transform + visibility) and backdrop fades (opacity)
         Details: shell=translate, visibility 0.2s; backdrop=opacity 0.2s

--- [STEP 4] Open the mobile navigation drawer ---
  [PASS] [MOBILE_DRAWER_OVERLAY] Drawer is a fixed overlay flush to the left edge
         Details: open=true position=fixed left=0px top=0px transformX=0
  [PASS] [MOBILE_DRAWER_WIDTH] Drawer uses the Mail/Calendar 288px drawer width (max 85vw)
         Details: width=288px (max 319px)
  [PASS] [MOBILE_DRAWER_FULL_HEIGHT] Drawer spans the full viewport height
         Details: height=760px viewport=760px
  [PASS] [MOBILE_DRAWER_BACKDROP] Dimmed backdrop is present while the drawer is open
         Details: backdropShown=true opacity=1

--- [STEP 5] Drawer dismissal paths ---
  [PASS] [DRAWER_CLOSES_BACKDROP] Backdrop click closes the drawer and returns to the list
         Details: shellOpen=false listVisible=true transformX=-100 backdropShown=false
  [PASS] [SHELL_STAYS_MOUNTED] Closed drawer stays mounted off-canvas so the slide-out can play
         Details: mounted=true transformX=-100

--- [STEP 5B] Sample the close animation frame by frame ---
  [PASS] [DRAWER_ANIMATES_CLOSE] Closing the drawer interpolates through intermediate translate positions
         Details: samples=[0,-3,-16,-35,-50,-61,-69,-75,-80,-84,-88,-91,-93,-95]
  [PASS] [DRAWER_CLOSES_ESCAPE] Escape closes the drawer
         Details: shellOpen=false transformX=-100
  [PASS] [DRAWER_CLOSES_NAV] Selecting a navigation item closes the drawer
         Details: shellOpen=false listVisible=true

--- [STEP 6] Note selection opens the editor ---
  [PASS] [EDITOR_OPENS_ON_CLICK] Clicking a note opens the editor pane
         Details: editorBefore=false editorAfter=true

--- [STEP 7] Desktop split view after selection ---
  [PASS] [DESKTOP_SPLIT_ON_SELECT] Desktop splits into a 320-350px list plus the editor after a note is clicked
         Details: list=350px editor=772px
  [PASS] [NO_PAGE_ERRORS] No uncaught page errors during the run
         Details: none

--- DevTools state at final assertion ---
console messages: 31 (errors: 17)
  [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
non-error message types: ["debug","warn"]
failed requests: none
localStorage keys: ["byos_notes_sync_queue_c0000000-0000-0000-0000-000000000001","byos_week_start","byos_unified_inbox_excluded","byos_layout","byos_time_format","byos_notes_c0000000-0000-0000-0000-000000000001","byos_note_labels_c0000000-0000-0000-0000-000000000001","byos_language","byos_theme","byos_connected_accounts","byos_session_generation","byos_density","byos_note_labels_init_byos_note_labels_c0000000-0000-0000-0000-000000000001","byos_view_mode"]
sessionStorage keys: ["byos_msg_subject_d5407593-7c3b-45c0-bfd9-15c9a7de09f0","byos_msg_subject_0a1396d2-3cfe-4e0a-a290-82cd6ac048ff","byos_msg_category_e311272b-4ef4-4f8c-87e5-3a581441c82e","byos_msg_category_bcde7268-d542-4e4b-ab31-246b85bace74","byos_msg_sender_name_d5407593-7c3b-45c0-bfd9-15c9a7de09f0","byos_msg_snippet_9e530b46-5847-4583-b1c9-2efbbb714dfc","byos_msg_category_d4a7eb57-c3cc-4970-8b75-bfdf51206b23","byos_msg_snippet_570d721f-0317-4ddd-b66b-cb289bfa99c2","byos_msg_subject_1245b15b-9a66-4376-ab8f-9160e17d7a19","byos_msg_category_c0441042-c574-426f-8495-f1427f4373f1","byos_msg_category_4bb7ab91-994b-4b67-a5ab-db11372795c3","byos_msg_subject_8c41392b-ce7f-49e6-b7a7-b3506cb1e402","byos_msg_snippet_4bb7ab91-994b-4b67-a5ab-db11372795c3","byos_msg_subject_bb06cba8-b0c5-4604-a1ea-346e4cc9f117","byos_msg_category_8c41392b-ce7f-49e6-b7a7-b3506cb1e402","byos_msg_sender_name_570d721f-0317-4ddd-b66b-cb289bfa99c2","byos_msg_snippet_bcde7268-d542-4e4b-ab31-246b85bace74","byos_msg_snippet_7205e5ee-0f40-486d-a2b2-ebca8a275221","byos_msg_subject_722e051d-4667-412d-93d1-b959f578f41b","byos_msg_sender_name_bcde7268-d542-4e4b-ab31-246b85bace74","byos_msg_subject_e311272b-4ef4-4f8c-87e5-3a581441c82e","byos_msg_category_18115ffb-6081-4232-aac9-db77bdfbd0e3","byos_msg_subject_913f61da-db27-4b06-ab01-a3fb02dcdb1e","byos_sender_email_name_invoices@stripe.com","byos_msg_subject_c0441042-c574-426f-8495-f1427f4373f1","byos_msg_snippet_8c41392b-ce7f-49e6-b7a7-b3506cb1e402","byos_sender_email_name_notifications@github.com","byos_msg_sender_name_4bb7ab91-994b-4b67-a5ab-db11372795c3","byos_msg_subject_18115ffb-6081-4232-aac9-db77bdfbd0e3","byos_sender_email_name_dan@tldr.tech","byos_msg_snippet_2e7f2b27-49f0-40a6-a997-f3822eaf21eb","byos_msg_category_23c3c4a0-9fb6-4607-87f1-ca8371b2ad70","byos_msg_subject_4bb7ab91-994b-4b67-a5ab-db11372795c3","byos_org_member_name_bob@byos.local","byos_sender_email_name_devops@byos.local","byos_msg_subject_570d721f-0317-4ddd-b66b-cb289bfa99c2","byos_msg_category_722e051d-4667-412d-93d1-b959f578f41b","byos_msg_sender_name_62547fec-370e-4718-94ec-5fe6ba9339ff","byos_msg_subject_9e530b46-5847-4583-b1c9-2efbbb714dfc","byos_msg_sender_name_23c3c4a0-9fb6-4607-87f1-ca8371b2ad70","byos_sender_email_name_design@byos.local","byos_msg_sender_name_722e051d-4667-412d-93d1-b959f578f41b","byos_msg_category_b798701e-8143-4ddf-8d35-0996015e491a","byos_view_mode","byos_msg_subject_23c3c4a0-9fb6-4607-87f1-ca8371b2ad70","byos_msg_sender_name_545ad8ab-fce0-432f-92db-7c7418e67dd4","byos_sender_email_name_newsletter@pragmaticengineer.com","byos_active_module","byos_msg_snippet_b798701e-8143-4ddf-8d35-0996015e491a","byos_msg_snippet_5f0e1e1b-5387-4f78-a653-ce54c86eda5d","byos_sender_email_name_insights@radar.cloudflare.com","byos_sender_email_name_sarah.jenkins@designsystems.io","byos_msg_subject_c8175dea-21d2-4361-941a-589e330b2d1b","byos_msg_snippet_58230f39-c1f6-4c27-adb2-ac41bf004d1d","byos_msg_snippet_1245b15b-9a66-4376-ab8f-9160e17d7a19","byos_msg_snippet_722e051d-4667-412d-93d1-b959f578f41b","byos_msg_category_9e530b46-5847-4583-b1c9-2efbbb714dfc","byos_keys_published_c0000000-0000-0000-0000-000000000001_66c3f0c7cdad753ece2c6579efbcdcef3c903cd9a87093624be739abb04a1547_77fc3d2d62addcf72bfd0674a92abacc68112f1a79a0ecaef6e3cbef4cbac7c585ec1288a13577627c81dee67c53b345e415c9da382a0aaa6690512ed7b18089514e614383aa91cb2df81918e218ac7bbca61c810ec76dab4729c9921713f27447dc984a81b2aa980f52f23567273159fbc3185111dcc84f177866ba55c2923b52edc67023b30495f78281f9c054879a096445b9764a6286826c46ccfbf9bcc153326b85252c1ca675528e2b446e98da6b3b34718ac70b82a6bfa9f7aa0c8c315b4658e936ad17a2a2391bbaa6a48787a0633a493bd4c29040f32467ec704d08751eec2e4d6b3fdc5586e9f8378f18cdb9b62ca46081e4c17d411b911cac44d1fc26d4b88dc98845133185d55a7a87a168bd354b3009b5a16ab23f15a2303c0557fc4a2c793617e68e1d373a0f0c4270636cac617e86f5616db1a29dba7f93c9ad0671992a0309fcd89ca26a20471acc33d023840ab62200915ce83925d5c8f9d09ed0b83f43c6ca0a234c5fa83b4d16759800a7b32c7d2b7a066e3a3e76e361b98469f20a1701f51a60c6aa5f0a8f291805b64c7070a41f1be65a4b0bbf31579c5d67bea933be7992afa9c8922a6cc07a7b749c4b0711863096697a28d298dad29ccf19a2c2e426871c7a1001a1ad779f3943400fe42a2d8b1f12005b03b927f1279031dc1157453b5574733f0c3dd0576b5a48651679c9bcf1cdbff61b8f06ba7743975a0717c8360b69fa4e7882bd5aaace340159bcf2671b30517ad4bbdd37c1036998312aace9012f3548a358822bc5396fdff8a611a2c6f4809067bc3e45f22254769ecd58ccd0933d65f448b78517856a0d64739e93e79091e83223dc8d4193aa1dcb6c29b24529f7929650c59ee0060b00741fab17a21c9cd1d4543ec26be272183ef5ac6ee0b4c57752dc693c7fca335389c78009631617c5ac272d45e51017728e0c05820480cdaad4659d6693fdf37c55163face41f52b9c0fc1035f79124adfa8ad49a04223b98797521e8a742bb984823d67995351bb8897a23233b7da89166fc435ba76aef710f44e7c1e7d648c011bbd81551bf5aa9c4a7aa2b9030207b27ff15304fc9026ee11fbe6246589b76cd81a51359731edb599dea0cc98957656a8190607e467c88ee01023829ba3da5cb9fd121582b3ed5452b7cc517091b47927b8fd61101e9eb1658e14224a28e58e80ecbf715abf1a23a70c6cdf40d620683e317bc6746961c5a84ff409fa1ba6a26b102a4852a2b058dbe25996c46aded97a11dbb0828708576b411fc19497d60be66f2c5bad31b43e998ab578e0023b349f29cba09af2549a4f3ab518da771a62c0dc2b3244a7830f4b83575c07946659866b17d15f70362bb248eba5758dcb3e16b3c03f726fefa4c38c8852f64aaf03c7d43a36bc332262b635d00bd080f769534b38be64c73ba6b372ecb285d350c8fcabf64e8c869173eda1a571b7896a5db035bb03827334fb56c499ca07e9633ac59099d41f50793947535b4c85f61b864ab51c1784abe52625886a24f2860725b400be67939690f51bc5f11051003c300557a026f027d00d19e9d5a8cc3a628b41b6d0e82a5a3e349125b20c7605fea600a56d51392638c5de83f48a4f408c972fda7ef036b0550eab637af44adcbe0e1372bdd33a45db33e4e7f624de4568a887751db1b5810e25545652a7bd5a53d6b6b1009200e34c3265a5a","byos_msg_sender_name_f1e6a098-a073-4503-a2c4-c9a59de22081","byos_sender_email_name_legal@byos.local","byos_msg_subject_5f0e1e1b-5387-4f78-a653-ce54c86eda5d","byos_msg_subject_545ad8ab-fce0-432f-92db-7c7418e67dd4","byos_msg_sender_name_e311272b-4ef4-4f8c-87e5-3a581441c82e","byos_connected_accounts","byos_msg_subject_f1e6a098-a073-4503-a2c4-c9a59de22081","byos_msg_snippet_e311272b-4ef4-4f8c-87e5-3a581441c82e","byos_msg_category_bb06cba8-b0c5-4604-a1ea-346e4cc9f117","byos_msg_snippet_545ad8ab-fce0-432f-92db-7c7418e67dd4","byos_msg_category_c8175dea-21d2-4361-941a-589e330b2d1b","byos_msg_sender_name_c8175dea-21d2-4361-941a-589e330b2d1b","byos_msg_category_2e7f2b27-49f0-40a6-a997-f3822eaf21eb","byos_msg_category_58230f39-c1f6-4c27-adb2-ac41bf004d1d","byos_sender_email_name_david.chen@byos.local","byos_sender_email_name_bob@byos.local","byos_msg_subject_bcde7268-d542-4e4b-ab31-246b85bace74","byos_msg_category_f1e6a098-a073-4503-a2c4-c9a59de22081","byos_msg_category_02fa1dd8-583a-4953-a28d-2e6b761ca6af","byos_msg_snippet_18115ffb-6081-4232-aac9-db77bdfbd0e3","byos_msg_sender_name_2e7f2b27-49f0-40a6-a997-f3822eaf21eb","byos_msg_subject_ac8f7cee-a837-4893-812f-86d6955cc1d8","byos_msg_subject_58230f39-c1f6-4c27-adb2-ac41bf004d1d","byos_sender_email_name_promotions@crypto-moon-yields-889.xyz","byos_msg_snippet_62547fec-370e-4718-94ec-5fe6ba9339ff","byos_msg_category_d5407593-7c3b-45c0-bfd9-15c9a7de09f0","byos_msg_category_62547fec-370e-4718-94ec-5fe6ba9339ff","byos_msg_category_913f61da-db27-4b06-ab01-a3fb02dcdb1e","byos_msg_category_1245b15b-9a66-4376-ab8f-9160e17d7a19","byos_msg_subject_d4a7eb57-c3cc-4970-8b75-bfdf51206b23","byos_msg_subject_02fa1dd8-583a-4953-a28d-2e6b761ca6af","byos_msg_sender_name_178aa67f-fa69-4b84-9faa-29a88e1219e3","byos_msg_sender_name_913f61da-db27-4b06-ab01-a3fb02dcdb1e","byos_session_generation","byos_msg_snippet_c0441042-c574-426f-8495-f1427f4373f1","byos_msg_snippet_0a1396d2-3cfe-4e0a-a290-82cd6ac048ff","byos_msg_subject_2edb7c58-7024-4f9b-af8c-35fd02cd4277","byos_msg_subject_62547fec-370e-4718-94ec-5fe6ba9339ff","byos_msg_subject_8a52f560-a555-469f-83fc-ea829001eaec","byos_msg_snippet_8a52f560-a555-469f-83fc-ea829001eaec","byos_msg_sender_name_b798701e-8143-4ddf-8d35-0996015e491a","byos_msg_category_570d721f-0317-4ddd-b66b-cb289bfa99c2","byos_msg_category_5f0e1e1b-5387-4f78-a653-ce54c86eda5d","byos_msg_category_967cb198-af02-4847-84af-040d944b2c77","byos_msg_subject_2e7f2b27-49f0-40a6-a997-f3822eaf21eb","byos_sender_email_name_alice@byos.local","byos_msg_subject_178aa67f-fa69-4b84-9faa-29a88e1219e3","byos_msg_category_7205e5ee-0f40-486d-a2b2-ebca8a275221","byos_msg_snippet_f1e6a098-a073-4503-a2c4-c9a59de22081","byos_msg_sender_name_c0441042-c574-426f-8495-f1427f4373f1","byos_msg_category_545ad8ab-fce0-432f-92db-7c7418e67dd4","byos_msg_category_0a1396d2-3cfe-4e0a-a290-82cd6ac048ff","byos_msg_snippet_bb06cba8-b0c5-4604-a1ea-346e4cc9f117","byos_msg_snippet_c8175dea-21d2-4361-941a-589e330b2d1b","byos_msg_snippet_967cb198-af02-4847-84af-040d944b2c77","byos_msg_sender_name_8a52f560-a555-469f-83fc-ea829001eaec","byos_msg_subject_967cb198-af02-4847-84af-040d944b2c77","byos_msg_category_8a52f560-a555-469f-83fc-ea829001eaec","byos_msg_snippet_02fa1dd8-583a-4953-a28d-2e6b761ca6af","byos_msg_snippet_ac8f7cee-a837-4893-812f-86d6955cc1d8","byos_msg_snippet_d4a7eb57-c3cc-4970-8b75-bfdf51206b23","byos_session_vault","byos_sender_email_name_guild@byos.local","byos_msg_snippet_2edb7c58-7024-4f9b-af8c-35fd02cd4277","byos_msg_category_2edb7c58-7024-4f9b-af8c-35fd02cd4277","byos_msg_sender_name_7205e5ee-0f40-486d-a2b2-ebca8a275221","byos_msg_sender_name_02fa1dd8-583a-4953-a28d-2e6b761ca6af","byos_msg_subject_7205e5ee-0f40-486d-a2b2-ebca8a275221","byos_msg_snippet_178aa67f-fa69-4b84-9faa-29a88e1219e3","byos_msg_snippet_913f61da-db27-4b06-ab01-a3fb02dcdb1e","byos_msg_snippet_23c3c4a0-9fb6-4607-87f1-ca8371b2ad70","byos_msg_subject_b798701e-8143-4ddf-8d35-0996015e491a","byos_msg_category_178aa67f-fa69-4b84-9faa-29a88e1219e3","byos_org_member_name_alice@byos.local","byos_msg_category_ac8f7cee-a837-4893-812f-86d6955cc1d8","byos_msg_sender_name_2edb7c58-7024-4f9b-af8c-35fd02cd4277","byos_sender_email_name_hr@byos.local","byos_msg_snippet_d5407593-7c3b-45c0-bfd9-15c9a7de09f0"]
error responses (17):
  2x 401 http://127.0.0.1:3001/v1/auth/me
  1x 404 http://127.0.0.1:3001/v1/keys/notifications%40github.com
  2x 404 http://127.0.0.1:3001/v1/keys/david.chen%40byos.local
  1x 404 http://127.0.0.1:3001/v1/keys/promotions%40crypto-moon-yields-889.xyz
  1x 404 http://127.0.0.1:3001/v1/keys/newsletter%40pragmaticengineer.com
  1x 404 http://127.0.0.1:3001/v1/keys/dan%40tldr.tech
  1x 404 http://127.0.0.1:3001/v1/keys/devops%40byos.local
  1x 404 http://127.0.0.1:3001/v1/keys/insights%40radar.cloudflare.com
  1x 404 http://127.0.0.1:3001/v1/keys/sarah.jenkins%40designsystems.io
  1x 404 http://127.0.0.1:3001/v1/keys/guild%40byos.local
  1x 404 http://127.0.0.1:3001/v1/keys/invoices%40stripe.com
  1x 404 http://127.0.0.1:3001/v1/keys/legal%40byos.local
  1x 404 http://127.0.0.1:3001/v1/keys/design%40byos.local
  1x 404 http://127.0.0.1:3001/v1/keys/hr%40byos.local
  1x 404 http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/storage/retrieve

==============================================================================
  SUMMARY: 19/19 checks passed
==============================================================================
```

### 4. Browser suite — three-pane workspace

Command: `node tests/browser/verify_notes_three_pane_redesign.mjs` (exit 0, 16/16 checks).

```
================================================================================
   BYOS NOTES: NOTESNOOK-INSPIRED THREE-PANE WORKSPACE E2E VERIFICATION        
================================================================================

--- [STEP 1] Login Flow as Alice (alice@byos.local) ---
  [HTTP 401] GET http://127.0.0.1:3001/v1/auth/me: unauthorized

  [PASS] [AUTH_01] Login as Alice and load session
         Details: Account chip selector displayed

--- [STEP 2] Switch to Notes Module ---
  Desktop list-first layout status: {"hasSidebar":true,"hasList":true,"hasEditor":false,"sidebarWidth":256,"listWidth":962,"editorWidth":0,"viewportWidth":1280}
  [PASS] [LAYOUT_01] Notes opens list-first on desktop: sidebar and list render, editor stays closed until a note is opened
         Details: Sidebar: 256px, List: 962px (viewport 1280px), Editor mounted: false
  [PASS] [RESP_1440] Desktop 1440px has zero horizontal overflow
         Details: scrollWidth: 1440px, innerWidth: 1440px
  Saved screenshot: tests\browser\artifacts\notes_three_pane_desktop_workspace.png
  Saved screenshot: tests\browser\artifacts\notes_sidebar_and_list.png

--- [STEP 3] Create a New Note in Pane 1 ---
  Saved screenshot: tests\browser\artifacts\notes_selected_opened_in_editor.png
  [PASS] [EDITOR_01] Direct in-canvas note title and content editing
         Details: Saved note content directly
  Desktop three-pane split status: {"hasSidebar":true,"hasList":true,"hasEditor":true,"sidebarWidth":256,"listWidth":350,"editorWidth":772}
  [PASS] [LAYOUT_02] Three panes render simultaneously once a note is opened: sidebar, 320-350px list, and editor
         Details: Sidebar: 256px, List: 350px, Editor: 772px
  Saved screenshot: tests\browser\artifacts\notes_three_pane_desktop_split.png

--- [STEP 4] Test Notesnook-Inspired Rich-Text Toolbar ---
  Toolbar capabilities: {"hasHeadings":true,"hasBold":true,"hasItalic":true,"hasUnderline":true,"hasStrikethrough":true,"hasBullet":true,"hasNumbered":true,"hasChecklist":true,"hasQuote":true,"hasCode":true,"hasLink":true}
  [PASS] [TOOLBAR_01] Notesnook rich-text toolbar rendered with all formatting tools
         Details: All formatting buttons present
  Saved screenshot: tests\browser\artifacts\notes_richtext_toolbar_editing.png

--- [STEP 5] Test Favoriting Note (pin retired) ---
  [HTTP 404] GET http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/storage/retrieve?key=mailboxes%2Fc0000000-0000-0000-0000-000000000001%2Fnotes%2Fmedia%2Fimage_1794327683654_vp78z.enc: object not found in storage

  [PASS] [PIN_RETIRED] Pin action is removed from the note editor toolbar
         Details: notes-editor-pin-btn count: 0
  Favorites category item count: 1
  [PASS] [FAV_01] Favorite action filters note in Favorites view
         Details: Found: true
  Saved screenshot: tests\browser\artifacts\notes_favorites_label_filtering.png
  [PASS] [FAV_02] Unfavorite action removes note from Favorites view
         Details: Count after unfavorite: 0
  [PASS] [FAV_PERSIST] Favorite state persists across reload and rehydration
         Details: Found 1 favorite notes after reload

--- [STEP 5B] Test Tablet Viewport (768x1024) ---
  [PASS] [RESP_768] Tablet 768px has zero horizontal overflow
         Details: scrollWidth: 768px, innerWidth: 768px

--- [STEP 5C] Test Existing Functionality Regression ---
  [PASS] [REG_DUP] Duplicate note action creates copy with distinct ID
         Details: Copy detected in list: true
  [PASS] [REG_CHECKLIST] Toggle checklist mode reveals interactive checklist items
         Details: Checklist rendered: true

--- [STEP 6] Test Dark Mode Workspace ---
  Saved screenshot: tests\browser\artifacts\notes_three_pane_dark_mode.png
  [PASS] [DARK_01] Dark mode renders seamlessly across 3 panes
         Details: Captured dark mode screenshot

--- [STEP 7] Test Mobile Viewport (375x667) Single-Pane Flow ---
  [PASS] [RESP_375] Mobile 375px has zero horizontal overflow
         Details: scrollWidth: 375px, innerWidth: 375px
  Saved screenshot: tests\browser\artifacts\notes_mobile_list_view.png
  Tapping note item to open mobile editor (Pane 3)...
  Saved screenshot: tests\browser\artifacts\notes_mobile_editor_view.png
  [PASS] [MOBILE_01] Mobile responsive single-pane navigation (Sidebar -> List -> Editor -> List -> Sidebar)
         Details: 375px verified

================================================================================
                           TEST SUMMARY                                         
================================================================================
Results: 16/16 checks passed.
Network errors (2): [
  {
    url: 'http://127.0.0.1:3001/v1/auth/me',
    status: 401,
    text: 'unauthorized\n'
  },
  {
    url: 'http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/storage/retrieve?key=mailboxes%2Fc0000000-0000-0000-0000-000000000001%2Fnotes%2Fmedia%2Fimage_1794327683654_vp78z.enc',
    status: 404,
    text: 'object not found in storage\n'
  }
]
```

### 5. Browser suite — UI consistency, spacing, and action toolbar

Command: `node tests/browser/verify_notes_ui_consistency.mjs` (exit 0, 16/16 checks).

```
================================================================================
   BYOS NOTES: UI CONSISTENCY, SPACING & ACTION TOOLBAR VERIFICATION             
================================================================================

--- [STEP 1] Login Flow as Alice ---
  [PASS] [AUTH_01] Login as Alice succeeded
         Details: Account chip selector mounted

--- [STEP 2] Measure Mail Sidebar & Action Button ---
  Mail sidebar width: 256px, Compose button height: 44px
  [PASS] [SIDEBAR_MAIL_WIDTH] Mail sidebar width is 256px
         Details: Computed width: 256px, Compose button min-height: 44px

--- [STEP 3] Measure Calendar Sidebar & Action Button ---
  Calendar sidebar width: 256px, New Event button height: 44px
  [PASS] [SIDEBAR_CAL_WIDTH] Calendar sidebar width is 256px
         Details: Computed width: 256px, New Event button min-height: 44px

--- [STEP 4] Measure Notes Sidebar & Action Button ---
  Notes sidebar width: 256px, New Note button height: 44px
  [PASS] [SIDEBAR_NOTES_WIDTH] Notes sidebar width is 256px (identical to Mail and Calendar)
         Details: Computed width: 256px, New Note button min-height: 44px
  [PASS] [SIDEBAR_WIDTH_EQUALITY] Sidebar width is identical across Mail, Calendar, and Notes with 0px shift
         Details: Mail: 256px, Calendar: 256px, Notes: 256px
  [PASS] [ACTION_BUTTONS_STANDARDIZED] Sidebar action buttons share identical height (44px) and styling
         Details: Mail btn: 44px, Cal btn: 44px, Notes btn: 44px

--- [STEP 5] Verify Notes Editor Usable Width & Spacing ---
  Editor metrics (1440px): {
  paneWidth: 772,
  containerWidth: 708,
  titleWidth: 708,
  contentWidth: 708,
  leftTitleOffset: 675,
  leftContentOffset: 675
}
  [PASS] [EDITOR_CONTAINER_RATIO] Notes editor usable container width utilizes >90% of available pane width on standard desktop
         Details: Container width: 708px / 772px (91.7%)
  Editor metrics (1920px): { paneWidth: 1252, containerWidth: 1024 }
  [PASS] [EDITOR_WIDE_EXPANSION] Notes editor expands beyond 850px (reaching max-w-5xl / 1024px) on wide desktop screens
         Details: Container width on 1920px viewport: 1024px (pane: 1252px)
  [PASS] [EDITOR_TITLE_BODY_ALIGNMENT] Title textarea and document body editor align consistently with identical left offset
         Details: Title left: 675px, Content left: 675px

--- [STEP 6] Verify Notes Action Toolbar Icons ---
  [PASS] [PIN_RETIRED] Pin button is gone and the favorite star takes the first toolbar slot
         Details: pinBtnAbsent=true visibleActions=["notes-editor-favorite-btn","notes-editor-reminder-btn","notes-editor-labels-btn"]
  [PASS] [TOOLBAR_ICONS_MAPPING] Active action toolbar icons (Favorite, Reminder, Label, More) correctly mapped; retired Pin and Palette buttons absent
         Details: Tooltips: "Add to favorites", "Reminder", "Manage labels", "More note actions"; paletteBtnAbsent=true pinBtnAbsent=true
  [PASS] [FAVORITE_TOGGLE_ACTIVE] Favorite star toggles its pressed state, tooltip and filled icon
         Details: aria-pressed="true" title="Remove from favorites" fill="currentColor"

--- [STEP 7] Verify Note Color System Is Retired ---
  [PASS] [COLOR_SYSTEM_RETIRED] Palette button, color picker menu and color options are absent
         Details: paletteBtn=false pickerMenu=false colorOption=false

--- [STEP 8] Verify Neutral Surfaces Across Page Reload ---
  [PASS] [NEUTRAL_SURFACES_PERSIST] Editor and list surfaces stay neutral after reload (no per-note tint or color dot)
         Details: Title: "Enterprise Architecture & Infrastructure Document", paneNeutral=true, cardNotTinted=true, colorDot=false

--- [STEP 9] Verify Save & Sync Status ---
  Save & Sync status: { saveStatus: 'Γ£ô Saved', syncStatus: 'Sync: idle' }
  [PASS] [STATUS_HEALTHY_RECOVERY] Save and Sync status report healthy accurate state without stale error
         Details: Save status: "Γ£ô Saved", Sync status: "Sync: idle"

--- [STEP 10] Mobile 375px Viewport Scaling ---
  Mobile metrics (375px): {
  scrollWidth: 375,
  clientWidth: 375,
  hasHorizontalOverflow: false,
  editorVisible: true
}
  [PASS] [MOBILE_375PX_RESPONSIVE] Mobile 375px viewport scales seamlessly with zero horizontal overflow
         Details: ScrollWidth: 375px, ClientWidth: 375px, Overflow: false

================================================================================
   TEST SUMMARY                                                                 
================================================================================
Total checks: 16 | Passed: 16 | Failed: 0
```

### 6. Browser suite — WYSIWYG and multiline title wrapping

Command: `node tests/browser/test_notes_wysiwyg_and_title_wrapping.mjs` (exit 0, 13/13 checks).

```
================================================================================
   BYOS NOTES: WYSIWYG RICH-TEXT & MULTILINE TITLE WRAPPING VERIFICATION        
================================================================================

--- [STEP 1] Login Flow as Alice ---
  [PASS] [AUTH_01] Login as Alice succeeded
         Details: Session loaded

--- [STEP 2] Navigate to Notes Module ---

--- [STEP 3] Create a New Note for WYSIWYG & Title Testing ---
  [PASS] [TITLE_TAG] Title input is rendered as textarea element
         Details: Tag: textarea

--- [STEP 4] Test WYSIWYG Inline Formatting ---
  Selected 'zero-knowledge': true
  Selected 'architecture': true
  Selected 'confidentiality': true
  Selected 'absolute': true
  Inline DOM evaluation: {"html":"<p>The <b>zero-knowledge</b> <i>architecture</i> guarantees <u>confidentiality</u> and <strike>absolute</strike> privacy.</p>","text":"The zero-knowledge architecture guarantees confidentiality and absolute privacy.","hasBoldTag":true,"hasItalicTag":true,"hasUnderlineTag":true,"hasStrikeTag":true,"hasRawMarkdownAsterisks":false,"hasRawMarkdownTildes":false}
  [PASS] [WYSIWYG_BOLD] Bold visually renders via <b>/<strong> without literal ** syntax
         Details: Bold tag: true
  [PASS] [WYSIWYG_ITALIC] Italic visually renders via <i>/<em> without literal * syntax
         Details: Italic tag: true
  [PASS] [WYSIWYG_UNDERLINE] Underline visually renders via <u> element
         Details: Underline tag: true
  [PASS] [WYSIWYG_STRIKE] Strikethrough visually renders via <s>/<strike> without literal ~~ syntax
         Details: Strike tag: true
  Saved screenshot: tests\browser\artifacts\notes_wysiwyg_inline_formatting.png

--- [STEP 5] Test Combined Formatting (Bold + Italic) ---
  Selected 'privacy': true
  [PASS] [WYSIWYG_COMBINED] Combined formatting (Bold + Italic) visually applies to identical selection
         Details: HTML contains nested bold & italic tags: true
  Saved screenshot: tests\browser\artifacts\notes_wysiwyg_combined_formatting.png

--- [STEP 6] Test Headings and Lists Formatting ---
  [PASS] [WYSIWYG_H1] Heading 1 formats as native <h1> element
         Details: h1: true
  [PASS] [WYSIWYG_LIST] Bulleted list formats as native <ul><li> elements
         Details: ul: true
  Saved screenshot: tests\browser\artifacts\notes_wysiwyg_headings_and_lists.png

--- [STEP 7] Test Multiline Title Wrapping (Desktop 1440px) ---
  Desktop Title metrics: {"tagName":"textarea","clientHeight":117,"scrollHeight":117,"clientWidth":708,"scrollWidth":708,"whiteSpace":"pre-wrap","wordBreak":"normal","hasHorizontalOverflow":false,"isMultiLine":true}
  [PASS] [TITLE_WRAP_DESKTOP] Long title expands vertically across multiple lines without horizontal overflow on desktop
         Details: Height: 117px, MultiLine: true, HorizOverflow: false
  Saved screenshot: tests\browser\artifacts\notes_title_wrapping_multiline_desktop.png

--- [STEP 8] Test Multiline Title Wrapping (Mobile 375px) ---
  Mobile on list -> tapping note to open editor...
  Mobile Title metrics (375px): {"clientHeight":184,"scrollHeight":184,"clientWidth":329,"scrollWidth":329,"pageScrollWidth":375,"hasPageHorizontalOverflow":false,"hasTitleHorizontalOverflow":false,"heightIncreased":true}
  [PASS] [TITLE_WRAP_MOBILE] Title wraps down seamlessly at 375px mobile viewport with zero page overflow
         Details: Title height: 184px, Page scrollWidth: 375px
  Saved screenshot: tests\browser\artifacts\notes_title_wrapping_mobile_375px.png

--- [STEP 9] Test Auto-Save and Reload Persistence ---
  Reloaded state check: {"titleValue":"Comprehensive End-to-End Cryptographic Protocol and Infrastructure Resilience Audit Report for Autonomous Distributed Workspace Architecture","hasBoldTag":true,"hasItalicTag":true,"hasUnderlineTag":true,"hasH1":true,"hasRawMarkdown":false}
  [PASS] [PERSIST_TITLE] Long multiline title persists accurately after reload
         Details: Title: Comprehensive End-to-End Cryptographic Protocol an...
  [PASS] [PERSIST_FORMAT] WYSIWYG formatting tags (<b>, <i>, <u>, <h1>) persist and rehydrate without raw markdown corruption
         Details: Bold: true, Italic: true, Underline: true, NoRawMarkdown: true

================================================================================
                           TEST SUMMARY                                         
================================================================================
Results: 13/13 checks passed.
```

## Manual browser verification

All runs use the real login flow (`alice@byos.local` / `test-password-123`) against the running dev stack (webmail `http://127.0.0.1:3001`, API `:8080`), the real Notes module, and real notes created and edited through the UI. The suites also dump console messages, failed requests, ≥400 responses, and storage keys at the final assertion (see the DevTools sections in the pasted logs).

| Check | Action exercised | Observed |
|-------|------------------|----------|
| Desktop opens list-only | Open Notes at 1440×900 with no note selected | sidebar 256px `static`, list 1122px, editor not mounted (`DESKTOP_LIST_ONLY`, `LAYOUT_01`) |
| Editor opens on note click | Click a list row | editor mounts and becomes visible; list becomes 350px and editor 772px (`EDITOR_OPENS_ON_CLICK`, `DESKTOP_SPLIT_ON_SELECT`, `LAYOUT_02`) |
| Favorite takes the pin slot | Inspect toolbar, toggle the star | visible actions are `favorite, reminder, labels`; pin button count 0; star toggles to `aria-pressed="true"`, `title="Remove from favorites"`, `fill="currentColor"` (`PIN_RETIRED`, `FAVORITE_TOGGLE_ACTIVE`) |
| Favorite filters like a star | Favorite, open Favorites, unfavorite, reload | note appears in Favorites, disappears on unfavorite, persists after reload (`FAV_01`, `FAV_02`, `FAV_PERSIST`) |
| Phone list-first | Resize to 375×760 | list visible, drawer closed at `translate: -100%` (`MOBILE_LIST_FIRST`) |
| Drawer opens/closes with motion | Tap the categories button, then dismiss | drawer renders as a 288px out-of-flow overlay at left 0 / top 0, full height, backdrop opacity 1; close samples show intermediate positions `0 → -3 → -16 → -35 → -50 → … → -100` (`DRAWER_ANIMATES_CLOSE`) |
| Dismissal paths | Backdrop click, Escape, nav selection | drawer closes each time; shell stays mounted off-canvas (`SHELL_STAYS_MOUNTED`) |
| No horizontal scroll | 375px, 768px, 1440px | document/body scroll widths equal the viewport (`MOBILE_NO_HSCROLL`, `RESP_375`, `RESP_768`, `RESP_1440`) |

Screenshots saved in the repository (`tests/browser/artifacts/`):

| Screenshot | What it shows |
|------------|----------------|
| `notes_desktop_sidebar_256px.png` | Desktop Notes with the 256px sidebar and the full-width list, no editor pane |
| `notes_desktop_split_editor.png` | Desktop split after clicking a note (350px list + editor) |
| `notes_mobile_list_375px.png` | 375px phone view on the note list with the drawer closed |
| `notes_mobile_drawer_open.png` | 375px phone view with the animated navigation drawer open |
| `notes_mobile_editor_375px.png` | 375px phone view with the editor open after tapping a note |

## What did not work or is untested

- **Flaky checklist regression check (repaired, then re-run):** the first patched run of `verify_notes_three_pane_redesign.mjs` failed `REG_CHECKLIST` (`Checklist rendered: false`). The cause was the newly added explicit note click immediately before STEP 5C: the note's async content rehydration could land between the checklist toggle and the assertion and reset the local editor mode. The test now re-opens the note created in STEP 3, normalizes it to text mode if a previous interrupted run left it toggled, and waits for decrypted content before opening the menu. The two subsequent full runs passed 16/16 (log above). **UNTESTED**: a long soak of that race beyond the two consecutive passes.
- **`tsc --noEmit` exits 2**, not 0. All 12 errors are pre-existing in `src/offline.test.ts` (lines 460, 619–626, 861) and are unrelated to this task; they were present before the change. **UNTESTED**: correcting them (out of scope).
- **`biome check`/format debt is pre-existing.** `npx biome lint src/components/notes` reports only warnings/infos (unused imports, `isNaN`, `innerText`) that exist across untouched files too; this change adds no new lint findings. `biome check` (which includes formatting) still flags the whole notes folder, including files this task never edited. **UNTESTED**: a repo-wide formatting sweep (out of scope).
- **Motion-reduce path not exercised.** The drawer uses `motion-reduce:transition-none`; headless Chrome was not run with `prefers-reduced-motion: reduce` emulation.
- **Only Chromium was tested.** Firefox, Safari, and real iOS/Android devices were not exercised.
- **Pin store code is retained on purpose.** `isPinned` and `togglePinNote` still exist in the data model and sync payloads so stored and encrypted notes keep round-tripping; this report does not claim the data model was purged. **UNTESTED**: a future data-model migration that removes `isPinned` (not part of this task).
- **Scratch logs are not committed.** Raw logs used to build this report live in `scratch/bt_*.txt`, `scratch/unit_raw.txt`, `scratch/tsc_noemit.txt`, and `scratch/*_diffs.txt` (gitignored); their content is pasted below.

## Test file diffs

`tests/browser/notes_mobile_drawer.mjs` is a new file (shown as `?? tests/browser/notes_mobile_drawer.mjs` in `git status`), so it has no diff; its 19 checks are in the run output above. The three pre-existing suites are modified and their full diffs follow.

```
diff --git a/tests/browser/test_notes_wysiwyg_and_title_wrapping.mjs b/tests/browser/test_notes_wysiwyg_and_title_wrapping.mjs
index a635f2f..386f5fa 100644
--- a/tests/browser/test_notes_wysiwyg_and_title_wrapping.mjs
+++ b/tests/browser/test_notes_wysiwyg_and_title_wrapping.mjs
@@ -392,14 +392,18 @@ async function run() {
     await page.setViewport({ width: 375, height: 812 });
     await sleep(800);
 
-    // Check if sidebar is showing on mobile
-    const sidebarVisible = await page.evaluate(() => {
-      const sb = document.querySelector('[data-testid="notes-sidebar"]');
-      return Boolean(sb && sb.offsetParent !== null);
+    // The navigation drawer stays mounted off-canvas, so drawer visibility must be read
+    // from the computed style (visibility + translate), not offsetParent.
+    const drawerOpen = await page.evaluate(() => {
+      const shell = document.querySelector('[data-testid="notes-sidebar-shell"]');
+      if (!shell) return false;
+      const style = window.getComputedStyle(shell);
+      const translateX = Number.parseFloat((style.translate || "none").split(" ")[0]) || 0;
+      return style.visibility !== "hidden" && translateX === 0;
     });
 
-    if (sidebarVisible) {
-      console.log("  Mobile on sidebar -> selecting 'All Notes'...");
+    if (drawerOpen) {
+      console.log("  Mobile drawer open -> selecting 'All Notes'...");
       const allNotesBtn = await page.waitForSelector('[data-testid="notes-nav-notes"]', { timeout: 5000 });
       await allNotesBtn.click();
       await sleep(800);
diff --git a/tests/browser/verify_notes_three_pane_redesign.mjs b/tests/browser/verify_notes_three_pane_redesign.mjs
index 88ff8fe..fa5c821 100644
--- a/tests/browser/verify_notes_three_pane_redesign.mjs
+++ b/tests/browser/verify_notes_three_pane_redesign.mjs
@@ -3,10 +3,11 @@
  * BYOS Webmail: Redesign Notes into a Notesnook-Inspired Three-Pane Workspace
  *
  * Verifies:
- * 1. Full 3-pane desktop workspace (NotesSidebar, NotesList, NotesEditor).
+ * 1. List-first desktop workspace: sidebar + note list on load, expanding to three
+ *    panes (sidebar, list column, editor) once a note is opened.
  * 2. Creating, typing, formatting, and auto-saving notes directly in the editor.
  * 3. Notesnook-inspired rich-text formatting toolbar.
- * 4. Pinned, Favorited, Reminder, and Label status indicators.
+ * 4. Favorited, Reminder, and Label status indicators (pin system retired).
  * 5. Favorites and Label filtering in the sidebar.
  * 6. Dark mode styling and visual hierarchy.
  * 7. Mobile single-pane navigation flow at 375px viewport (Sidebar -> List -> Editor).
@@ -109,10 +110,10 @@ async function run() {
     await page.click('[data-testid="nav-notes-tab"]');
     await sleep(1500);
 
-    // Verify 3 Panes Exist on Desktop
+    // List-first workspace: the navigation sidebar and the note list render on load.
+    // The editor pane (Pane 3) mounts only after a note is clicked or created.
     await page.waitForSelector('[data-testid="notes-sidebar"]', { timeout: 5000 });
     await page.waitForSelector('[data-testid="notes-list-pane"]', { timeout: 5000 });
-    await page.waitForSelector('[data-testid="notes-editor-pane"]', { timeout: 5000 });
 
     const panesLayout = await page.evaluate(() => {
       const sidebar = document.querySelector('[data-testid="notes-sidebar"]');
@@ -125,15 +126,19 @@ async function run() {
         sidebarWidth: sidebar ? sidebar.getBoundingClientRect().width : 0,
         listWidth: list ? list.getBoundingClientRect().width : 0,
         editorWidth: editor ? editor.getBoundingClientRect().width : 0,
+        viewportWidth: window.innerWidth,
       };
     });
 
-    console.log("  Desktop 3-Pane Layout status:", JSON.stringify(panesLayout));
+    console.log("  Desktop list-first layout status:", JSON.stringify(panesLayout));
     recordResult(
       "LAYOUT_01",
-      "Three panes rendered simultaneously on desktop",
-      panesLayout.hasSidebar && panesLayout.hasList && panesLayout.hasEditor && panesLayout.editorWidth > 400,
-      `Sidebar: ${panesLayout.sidebarWidth}px, List: ${panesLayout.listWidth}px, Editor: ${panesLayout.editorWidth}px`
+      "Notes opens list-first on desktop: sidebar and list render, editor stays closed until a note is opened",
+      panesLayout.hasSidebar &&
+        panesLayout.hasList &&
+        !panesLayout.hasEditor &&
+        panesLayout.listWidth > 400,
+      `Sidebar: ${panesLayout.sidebarWidth}px, List: ${panesLayout.listWidth}px (viewport ${panesLayout.viewportWidth}px), Editor mounted: ${panesLayout.hasEditor}`
     );
 
     // Screenshot 1: Full desktop Notes workspace (1440px)
@@ -197,6 +202,41 @@ async function run() {
 
     recordResult("EDITOR_01", "Direct in-canvas note title and content editing", true, "Saved note content directly");
 
+    // -------------------------------------------------------------------------
+    // STEP 3B: Opening a note grows the list into a column and mounts Pane 3
+    // -------------------------------------------------------------------------
+    const splitLayout = await page.evaluate(() => {
+      const sidebar = document.querySelector('[data-testid="notes-sidebar"]');
+      const list = document.querySelector('[data-testid="notes-list-pane"]');
+      const editor = document.querySelector('[data-testid="notes-editor-pane"]');
+      return {
+        hasSidebar: Boolean(sidebar),
+        hasList: Boolean(list),
+        hasEditor: Boolean(editor),
+        sidebarWidth: sidebar ? sidebar.getBoundingClientRect().width : 0,
+        listWidth: list ? list.getBoundingClientRect().width : 0,
+        editorWidth: editor ? editor.getBoundingClientRect().width : 0,
+      };
+    });
+
+    console.log("  Desktop three-pane split status:", JSON.stringify(splitLayout));
+    recordResult(
+      "LAYOUT_02",
+      "Three panes render simultaneously once a note is opened: sidebar, 320-350px list, and editor",
+      splitLayout.hasSidebar &&
+        splitLayout.hasList &&
+        splitLayout.hasEditor &&
+        splitLayout.listWidth >= 320 &&
+        splitLayout.listWidth <= 350 &&
+        splitLayout.editorWidth > 400,
+      `Sidebar: ${splitLayout.sidebarWidth}px, List: ${splitLayout.listWidth}px, Editor: ${splitLayout.editorWidth}px`
+    );
+
+    // Screenshot: full three-pane workspace with a note open
+    const shotSplit = path.join(artifactsDir, "notes_three_pane_desktop_split.png");
+    await page.screenshot({ path: shotSplit });
+    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotSplit)}`);
+
     // -------------------------------------------------------------------------
     // STEP 4: Test Rich-Text Toolbar & Formatting
     // -------------------------------------------------------------------------
@@ -237,16 +277,23 @@ async function run() {
     console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotToolbar)}`);
 
     // -------------------------------------------------------------------------
-    // STEP 5: Test Pinning and Favoriting Note Lifecycle
+    // STEP 5: Test Favoriting Note Lifecycle (pin system retired)
     // -------------------------------------------------------------------------
-    console.log("\n--- [STEP 5] Test Pinning & Favoriting Note ---");
+    console.log("\n--- [STEP 5] Test Favoriting Note (pin retired) ---");
     // Click Favorite button in note header
     await page.click('[data-testid="notes-editor-favorite-btn"]');
     await sleep(600);
 
-    // Click Pin button in note header
-    await page.click('[data-testid="notes-editor-pin-btn"]');
-    await sleep(600);
+    // The pin action must not exist anywhere in the editor toolbar
+    const pinBtnCount = await page.evaluate(
+      () => document.querySelectorAll('[data-testid="notes-editor-pin-btn"]').length
+    );
+    recordResult(
+      "PIN_RETIRED",
+      "Pin action is removed from the note editor toolbar",
+      pinBtnCount === 0,
+      `notes-editor-pin-btn count: ${pinBtnCount}`
+    );
 
     // Filter to Favorites category in sidebar
     await page.click('[data-testid="notes-nav-favorites"]');
@@ -321,6 +368,39 @@ async function run() {
     await page.setViewport({ width: 1440, height: 900 });
     await sleep(400);
 
+    // Editor opens only on explicit click. Re-open the note created in STEP 3, normalize
+    // it to text mode (an interrupted run can leave the stored mode toggled), and wait
+    // for its decrypted content so async rehydration cannot reset the editor mode
+    // mid-assertion.
+    await page.waitForSelector('[data-testid="notes-list-item"]', { timeout: 5000 });
+    const createdNoteRow = await page.evaluateHandle(() =>
+      Array.from(document.querySelectorAll('[data-testid="notes-list-item"]')).find((el) =>
+        (el.textContent || "").includes("BYOS Zero-Knowledge Infrastructure Note")
+      )
+    );
+    const createdNoteEl = createdNoteRow.asElement();
+    if (createdNoteEl) {
+      await createdNoteEl.click();
+    } else {
+      await page.click('[data-testid="notes-list-item"]');
+    }
+    await page.waitForSelector('[data-testid="notes-editor-title-input"]', { timeout: 5000 });
+    await sleep(800);
+
+    if (await page.evaluate(() => Boolean(document.querySelector('[data-testid="notes-editor-checklist-items"]')))) {
+      await page.click('[data-testid="notes-editor-more-btn"]');
+      await sleep(400);
+      await page.click('[data-testid="editor-menu-toggle-checklist"]');
+      await sleep(700);
+    }
+    await page.waitForFunction(
+      () => {
+        const content = document.querySelector('[data-testid="notes-editor-content-input"]');
+        return Boolean(content && (content.innerText || "").trim().length > 0);
+      },
+      { timeout: 5000 }
+    );
+
     // -------------------------------------------------------------------------
     // STEP 5C: Test Existing Functionality Regression (Checklist, Duplicate, Archive)
     // -------------------------------------------------------------------------
@@ -396,24 +476,33 @@ async function run() {
       await sleep(1000);
     }
 
-    // 7A. In mobile single-pane flow: Check if sidebar is showing, tap "All Notes" to enter note list
-    const sidebarVisible = await page.evaluate(() => {
-      const sb = document.querySelector('[data-testid="notes-sidebar"]');
-      return Boolean(sb && sb.offsetParent !== null);
+    // 7A. Mobile opens on the note list. The navigation drawer stays mounted
+    // off-canvas, so visibility must be read from the computed style, not offsetParent.
+    const mobilePaneState = await page.evaluate(() => {
+      const shell = document.querySelector('[data-testid="notes-sidebar-shell"]');
+      let drawerOpen = false;
+      if (shell) {
+        const style = window.getComputedStyle(shell);
+        const translateX = Number.parseFloat((style.translate || "none").split(" ")[0]) || 0;
+        drawerOpen = style.visibility !== "hidden" && translateX === 0;
+      }
+      const editor = document.querySelector('[data-testid="notes-editor-pane"]');
+      const editorVisible = Boolean(editor && editor.getClientRects().length > 0);
+      return { drawerOpen, editorVisible };
     });
 
-    if (sidebarVisible) {
-      console.log("  Mobile starts on Notes Sidebar (Pane 1) -> selecting 'All Notes'...");
+    if (mobilePaneState.drawerOpen) {
+      console.log("  Mobile drawer is open -> selecting 'All Notes'...");
       const allNotesBtn = await page.waitForSelector('[data-testid="notes-nav-notes"]', { timeout: 5000 });
       await allNotesBtn.click();
       await sleep(800);
-    } else {
-      // If currently on editor, tap back to list
-      const editorBack = await page.$('[data-testid="notes-editor-back-btn"]');
-      if (editorBack && await page.evaluate(el => el.offsetParent !== null, editorBack)) {
-        await editorBack.click();
-        await sleep(600);
-      }
+    }
+
+    if (mobilePaneState.editorVisible) {
+      console.log("  Mobile editor is open -> tapping back to the note list...");
+      const editorBack = await page.waitForSelector('[data-testid="notes-editor-back-btn"]', { timeout: 5000 });
+      await editorBack.click();
+      await sleep(600);
     }
 
     // Screenshot 7: Mobile note list (Pane 2)
diff --git a/tests/browser/verify_notes_ui_consistency.mjs b/tests/browser/verify_notes_ui_consistency.mjs
index 598c67a..e983e7d 100644
--- a/tests/browser/verify_notes_ui_consistency.mjs
+++ b/tests/browser/verify_notes_ui_consistency.mjs
@@ -18,31 +18,28 @@
  *    - Calendar "New Event" (min-height 44px, py-2.5 px-4, rounded-xl, gradient, kbd 'E').
  *    - Notes "New Note" (min-height 44px, py-2.5 px-4, rounded-xl, gradient, kbd 'N').
  * 4. Action Toolbar Icons & Mapping:
- *    - Pin button: clean Lucide Pin icon, correct tooltip and toggle state.
- *    - Favorite button: Star icon, correct tooltip.
+ *    - Favorite star is the first note action; the retired Pin button must not render.
+ *    - Favorite button: Star icon, correct tooltip and pressed state.
  *    - Reminder button: Bell icon, correct tooltip.
  *    - Label button: Tag icon, correct tooltip.
- *    - Note Color button: Palette icon, correct tooltip.
  *    - More actions button: Three vertical dots, correct tooltip.
- * 5. Note Color Functionality:
- *    - Palette button opens compact color picker with 8 soft BYOS-branded colors.
- *    - Selecting a color updates store, auto-saves, and applies soft tint to editor and list item.
- *    - Survives page reload.
+ *    - Note Color button: retired ΓÇö must not render.
+ * 5. Neutral Note Surfaces (color system retired):
+ *    - Editor pane and list rows use the neutral surface (bg-white / dark:bg-[#18191D]).
+ *    - No palette button, no color picker menu, no per-note tint or color dot.
  * 6. Save & Sync Status:
  *    - Healthy states display "Γ£ô Saved" and "Sync: Synced" (or "Sync: idle").
  * 7. Mobile Responsiveness:
  *    - Viewport 375px scales smoothly with zero horizontal scroll.
  *
- * Saves 10 required screenshots in tests/browser/artifacts/:
+ * Saves 8 required screenshots in tests/browser/artifacts/:
  * - notes_editor_spacious_width.png
  * - notes_sidebar_standard_width.png
  * - mail_sidebar_standard_width.png
  * - calendar_sidebar_standard_width.png
  * - sidebar_action_buttons_comparison.png
  * - notes_action_toolbar_icons.png
- * - notes_color_picker_open.png
- * - notes_color_selected_background.png
- * - notes_color_persisted_reload.png
+ * - notes_neutral_surfaces_reload.png
  * - notes_editor_mobile_375px.png
  */
 
@@ -338,7 +335,7 @@ async function runSuite() {
     });
 
     // -------------------------------------------------------------------------
-    // STEP 6: Verify Action Toolbar Icons & Lucide Pin Icon
+    // STEP 6: Verify Action Toolbar Icons & Retired Pin Button
     // -------------------------------------------------------------------------
     console.log("\n--- [STEP 6] Verify Notes Action Toolbar Icons ---");
     const toolbarInfo = await page.evaluate(() => {
@@ -349,60 +346,77 @@ async function runSuite() {
       const palBtn = document.querySelector('[data-testid="notes-editor-palette-btn"]');
       const morBtn = document.querySelector('[data-testid="notes-editor-more-btn"]');
 
-      const pinSvg = pinBtn?.querySelector("svg")?.innerHTML || "";
       const favSvg = favBtn?.querySelector("svg")?.innerHTML || "";
       const remSvg = remBtn?.querySelector("svg")?.innerHTML || "";
       const lblSvg = lblBtn?.querySelector("svg")?.innerHTML || "";
-      const palSvg = palBtn?.querySelector("svg")?.innerHTML || "";
       const morSvg = morBtn?.querySelector("svg")?.innerHTML || "";
 
+      // The visible note actions in the left toolbar group, in DOM order.
+      const leftGroup = favBtn?.parentElement;
+      const visibleActionIds = Array.from(
+        leftGroup?.querySelectorAll('button[data-testid$="-btn"]') || []
+      )
+        .filter((btn) => btn.getClientRects().length > 0)
+        .map((btn) => btn.getAttribute("data-testid"));
+
       return {
-        pinTitle: pinBtn?.getAttribute("title"),
+        pinBtnAbsent: !pinBtn,
+        favPressed: favBtn?.getAttribute("aria-pressed"),
+        visibleActionIds,
+        favIsFirstAction: visibleActionIds[0] === "notes-editor-favorite-btn",
         favTitle: favBtn?.getAttribute("title"),
         remTitle: remBtn?.getAttribute("title"),
         lblTitle: lblBtn?.getAttribute("title"),
-        palTitle: palBtn?.getAttribute("title"),
         morTitle: morBtn?.getAttribute("title"),
-        hasPinLine: pinSvg.includes('line x1="12" y1="17" x2="12" y2="22"'),
-        hasPinPath: pinSvg.includes("M5 17h14v-1.76"),
+        paletteBtnAbsent: !palBtn,
         hasFavPolygon: favSvg.includes("polygon points="),
         hasRemPath: remSvg.includes("M18 8A6 6"),
         hasLblPath: lblSvg.includes("M20.59 13.41"),
-        hasPalCircles: palSvg.includes("circle cx="),
         hasMorCircles: morSvg.includes("circle cx="),
       };
     });
 
     recordResult(
-      "PIN_ICON_LUCIDE",
-      "Pin button displays recognizable clean Lucide Pin icon",
-      toolbarInfo.hasPinLine && toolbarInfo.hasPinPath,
-      `Pin title: "${toolbarInfo.pinTitle}", contains Lucide pin geometry`
+      "PIN_RETIRED",
+      "Pin button is gone and the favorite star takes the first toolbar slot",
+      toolbarInfo.pinBtnAbsent && toolbarInfo.favIsFirstAction && toolbarInfo.hasFavPolygon,
+      `pinBtnAbsent=${toolbarInfo.pinBtnAbsent} visibleActions=${JSON.stringify(toolbarInfo.visibleActionIds)}`
     );
 
     recordResult(
       "TOOLBAR_ICONS_MAPPING",
-      "All action toolbar icons (Pin, Favorite, Reminder, Label, Palette, More) correctly mapped",
+      "Active action toolbar icons (Favorite, Reminder, Label, More) correctly mapped; retired Pin and Palette buttons absent",
       toolbarInfo.hasFavPolygon &&
         toolbarInfo.hasRemPath &&
         toolbarInfo.hasLblPath &&
-        toolbarInfo.hasPalCircles &&
-        toolbarInfo.hasMorCircles,
-      `Tooltips: "${toolbarInfo.pinTitle}", "${toolbarInfo.favTitle}", "${toolbarInfo.remTitle}", "${toolbarInfo.lblTitle}", "${toolbarInfo.palTitle}", "${toolbarInfo.morTitle}"`
+        toolbarInfo.hasMorCircles &&
+        toolbarInfo.paletteBtnAbsent &&
+        toolbarInfo.pinBtnAbsent,
+      `Tooltips: "${toolbarInfo.favTitle}", "${toolbarInfo.remTitle}", "${toolbarInfo.lblTitle}", "${toolbarInfo.morTitle}"; paletteBtnAbsent=${toolbarInfo.paletteBtnAbsent} pinBtnAbsent=${toolbarInfo.pinBtnAbsent}`
     );
 
-    // Pin toggle test
-    await page.click('[data-testid="notes-editor-pin-btn"]');
-    await sleep(400);
-    const pinActive = await page.evaluate(() => {
-      const btn = document.querySelector('[data-testid="notes-editor-pin-btn"]');
-      return btn?.getAttribute("title");
+    // Favorite toggle test (deterministic: normalize to unstarred, then star it)
+    if (toolbarInfo.favPressed === "true") {
+      await page.click('[data-testid="notes-editor-favorite-btn"]');
+      await sleep(400);
+    }
+    await page.click('[data-testid="notes-editor-favorite-btn"]');
+    await sleep(500);
+    const favActive = await page.evaluate(() => {
+      const btn = document.querySelector('[data-testid="notes-editor-favorite-btn"]');
+      return {
+        pressed: btn?.getAttribute("aria-pressed"),
+        title: btn?.getAttribute("title"),
+        fill: btn?.querySelector("svg")?.getAttribute("fill"),
+      };
     });
     recordResult(
-      "PIN_TOGGLE_ACTIVE",
-      "Pin button toggles active state and updates tooltip",
-      pinActive === "Unpin note",
-      `Tooltip after click: "${pinActive}"`
+      "FAVORITE_TOGGLE_ACTIVE",
+      "Favorite star toggles its pressed state, tooltip and filled icon",
+      favActive.pressed === "true" &&
+        favActive.title === "Remove from favorites" &&
+        favActive.fill === "currentColor",
+      `aria-pressed="${favActive.pressed}" title="${favActive.title}" fill="${favActive.fill}"`
     );
 
     // Capture toolbar screenshot
@@ -412,66 +426,25 @@ async function runSuite() {
     });
 
     // -------------------------------------------------------------------------
-    // STEP 7: Verify Note Color Palette Functionality
+    // STEP 7: Note color system retired ΓÇö no palette UI may render
     // -------------------------------------------------------------------------
-    console.log("\n--- [STEP 7] Verify Note Color Palette Picker ---");
-    await page.click('[data-testid="notes-editor-palette-btn"]');
-    await sleep(400);
-
-    await page.waitForSelector('[data-testid="notes-color-picker-menu"]', { timeout: 3000 });
-    const colorPickerVisible = await page.evaluate(() => {
-      const menu = document.querySelector('[data-testid="notes-color-picker-menu"]');
-      const buttons = menu?.querySelectorAll("button") || [];
-      return {
-        visible: !!menu,
-        count: buttons.length,
-      };
-    });
-
+    console.log("\n--- [STEP 7] Verify Note Color System Is Retired ---");
+    const paletteState = await page.evaluate(() => ({
+      paletteBtn: !!document.querySelector('[data-testid="notes-editor-palette-btn"]'),
+      pickerMenu: !!document.querySelector('[data-testid="notes-color-picker-menu"]'),
+      colorOption: !!document.querySelector('[data-testid^="notes-color-option-"]'),
+    }));
     recordResult(
-      "COLOR_PICKER_MOUNTED",
-      "Color picker opens with 8 approved BYOS color options",
-      colorPickerVisible.visible && colorPickerVisible.count === 8,
-      `Option count: ${colorPickerVisible.count}`
+      "COLOR_SYSTEM_RETIRED",
+      "Palette button, color picker menu and color options are absent",
+      !paletteState.paletteBtn && !paletteState.pickerMenu && !paletteState.colorOption,
+      `paletteBtn=${paletteState.paletteBtn} pickerMenu=${paletteState.pickerMenu} colorOption=${paletteState.colorOption}`
     );
 
-    await page.screenshot({
-      path: path.join(artifactsDir, "notes_color_picker_open.png"),
-      clip: { x: 620, y: 35, width: 300, height: 80 },
-    });
-
-    // Select Peach color
-    await page.waitForSelector('[data-testid="notes-color-option-peach"]', { timeout: 3000 });
-    await page.click('[data-testid="notes-color-option-peach"]');
-    await sleep(600);
-
-    const noteColorApplied = await page.evaluate(() => {
-      const pane = document.querySelector('[data-testid="notes-editor-pane"]');
-      const activeCard = document.querySelector('[data-testid="notes-list-item"]');
-      const paneClass = pane?.className || "";
-      const cardColorDot = activeCard?.querySelector('[title*="Color: peach"]');
-      return {
-        paneHasPeachBg: paneClass.includes("bg-[#FFF2EB]") || paneClass.includes("dark:bg-[#342721]"),
-        hasCardColorDot: !!cardColorDot,
-        paneClass,
-      };
-    });
-
-    recordResult(
-      "NOTE_COLOR_APPLIED",
-      "Selected color applies soft background tint to editor and note indicator in list",
-      noteColorApplied.paneHasPeachBg && noteColorApplied.hasCardColorDot,
-      `Pane background contains peach token: ${noteColorApplied.paneHasPeachBg}, List item dot: ${noteColorApplied.hasCardColorDot}`
-    );
-
-    await page.screenshot({
-      path: path.join(artifactsDir, "notes_color_selected_background.png"),
-    });
-
     // -------------------------------------------------------------------------
-    // STEP 8: Reload Page & Verify Persistence of Spacing & Color
+    // STEP 8: Reload Page & Verify Neutral Surfaces Persist
     // -------------------------------------------------------------------------
-    console.log("\n--- [STEP 8] Verify Persistence Across Page Reload ---");
+    console.log("\n--- [STEP 8] Verify Neutral Surfaces Across Page Reload ---");
     await sleep(800); // Allow debounced auto-save
     await page.reload({ waitUntil: "networkidle2" });
     await sleep(1500);
@@ -480,34 +453,39 @@ async function runSuite() {
     await page.click('[data-testid="nav-notes-tab"]');
     await sleep(1000);
 
-    // Select the note
+    // The editor opens only on an explicit click
     await page.waitForSelector('[data-testid="notes-list-item"]', { timeout: 5000 });
     await page.click('[data-testid="notes-list-item"]');
     await sleep(800);
 
-    const persistedState = await page.evaluate(() => {
+    const neutralState = await page.evaluate(() => {
       const pane = document.querySelector('[data-testid="notes-editor-pane"]');
       const titleInput = document.querySelector('[data-testid="notes-editor-title-input"]');
       const activeCard = document.querySelector('[data-testid="notes-list-item"]');
-      const cardColorDot = activeCard?.querySelector('[title*="Color: peach"]');
       const paneClass = pane?.className || "";
-
+      const cardClass = activeCard?.className || "";
+      const tintedPane = ["bg-[#FFF2EB]", "dark:bg-[#342721]", "bg-[#FAF9F5]", "dark:bg-[#14161A]"].some(
+        (c) => paneClass.includes(c)
+      );
+      const tintedCard = ["bg-[#FFF2EB]", "dark:bg-[#342721]"].some((c) => cardClass.includes(c));
+      const colorDot = activeCard?.querySelector('[title*="Color:"]');
       return {
         title: titleInput?.value,
-        paneHasPeachBg: paneClass.includes("bg-[#FFF2EB]") || paneClass.includes("dark:bg-[#342721]"),
-        hasCardColorDot: !!cardColorDot,
+        paneNeutral: !tintedPane && paneClass.includes("bg-white") && paneClass.includes("dark:bg-[#18191D]"),
+        cardNotTinted: !tintedCard,
+        hasColorDot: !!colorDot,
       };
     });
 
     recordResult(
-      "NOTE_COLOR_PERSISTED",
-      "Note color and content persist completely after page reload",
-      persistedState.paneHasPeachBg && persistedState.hasCardColorDot,
-      `Title: "${persistedState.title}", Peach background: ${persistedState.paneHasPeachBg}`
+      "NEUTRAL_SURFACES_PERSIST",
+      "Editor and list surfaces stay neutral after reload (no per-note tint or color dot)",
+      neutralState.paneNeutral && neutralState.cardNotTinted && !neutralState.hasColorDot,
+      `Title: "${neutralState.title}", paneNeutral=${neutralState.paneNeutral}, cardNotTinted=${neutralState.cardNotTinted}, colorDot=${neutralState.hasColorDot}`
     );
 
     await page.screenshot({
-      path: path.join(artifactsDir, "notes_color_persisted_reload.png"),
+      path: path.join(artifactsDir, "notes_neutral_surfaces_reload.png"),
     });
 
     // -------------------------------------------------------------------------
```

## Source diffs

```
diff --git a/apps/webmail/src/components/notes/NotesEditor.tsx b/apps/webmail/src/components/notes/NotesEditor.tsx
index bdc60c9..9abb4fe 100644
--- a/apps/webmail/src/components/notes/NotesEditor.tsx
+++ b/apps/webmail/src/components/notes/NotesEditor.tsx
@@ -1,6 +1,6 @@
 import { Component, createSignal, createMemo, createEffect, onMount, onCleanup, Show, For } from "solid-js";
 import DOMPurify from "dompurify";
-import { NoteItem, NoteChecklistItem, NOTE_COLORS } from "./notesStore";
+import { NoteItem, NoteChecklistItem } from "./notesStore";
 import { NotesEditorToolbar } from "./NotesEditorToolbar";
 import { NotesEmptyState } from "./NotesEmptyState";
 import { formatFullDateTime } from "../../utils/dateTime";
@@ -89,7 +89,6 @@ export interface NotesEditorProps {
   note: NoteItem | null;
   allLabels: string[];
   onUpdateNote: (patch: Partial<NoteItem>) => void;
-  onTogglePin: () => void;
   onToggleFavorite: () => void;
   onDeleteNote: () => void;
   onDeleteForever?: () => void;
@@ -248,7 +247,6 @@ export const NotesEditor: Component<NotesEditorProps> = (props) => {
   const [altTextInput, setAltTextInput] = createSignal("");
 
   // Popover menus state
-  const [showPaletteMenu, setShowPaletteMenu] = createSignal(false);
   const [showReminderMenu, setShowReminderMenu] = createSignal(false);
   const [showLabelMenu, setShowLabelMenu] = createSignal(false);
   const [showMoreMenu, setShowMoreMenu] = createSignal(false);
@@ -1288,18 +1286,6 @@ export const NotesEditor: Component<NotesEditorProps> = (props) => {
     setNewLabelInput("");
   };
 
-  const getColorTheme = () => {
-    return NOTE_COLORS.find((c) => c.id === color()) || NOTE_COLORS[0];
-  };
-
-  const editorBgClass = () => {
-    const theme = getColorTheme();
-    if (theme.id === "default") {
-      return "bg-[#FAF9F5] dark:bg-[#14161A]";
-    }
-    return `${theme.lightBg} ${theme.darkBg}`;
-  };
-
   const formattedUpdatedTime = () => {
     if (!props.note?.updatedAt) return "Just now";
     return formatFullDateTime(new Date(props.note.updatedAt).toISOString());
@@ -1308,7 +1294,7 @@ export const NotesEditor: Component<NotesEditorProps> = (props) => {
   return (
     <div
       data-testid="notes-editor-pane"
-      class={`flex-1 min-w-0 min-h-0 h-full ${editorBgClass()} flex flex-col overflow-hidden relative transition-colors duration-200 ${
+      class={`flex-1 min-w-0 min-h-0 h-full bg-white dark:bg-[#18191D] flex flex-col overflow-hidden relative transition-colors duration-200 ${
         props.class || ""
       }`}
     >
@@ -1378,35 +1364,13 @@ export const NotesEditor: Component<NotesEditorProps> = (props) => {
               </button>
             </Show>
 
-            {/* Pin / Unpin Action */}
-            <button
-              type="button"
-              onClick={props.onTogglePin}
-              data-testid="notes-editor-pin-btn"
-              title={props.note?.isPinned ? "Unpin note" : "Pin note"}
-              class={`w-8 h-8 rounded-lg flex items-center justify-center transition cursor-pointer ${
-                props.note?.isPinned
-                  ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
-                  : "text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
-              }`}
-            >
-              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
-                <line x1="12" y1="17" x2="12" y2="22" stroke-linecap="round" />
-                <path
-                  d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"
-                  stroke-linecap="round"
-                  stroke-linejoin="round"
-                  fill={props.note?.isPinned ? "currentColor" : "none"}
-                />
-              </svg>
-            </button>
-
-            {/* Favorite Action */}
+            {/* Favorite / Star Action ΓÇö takes the first slot, like the mail star */}
             <button
               type="button"
               onClick={props.onToggleFavorite}
               data-testid="notes-editor-favorite-btn"
               title={props.note?.isFavorite ? "Remove from favorites" : "Add to favorites"}
+              aria-pressed={props.note?.isFavorite ? "true" : "false"}
               class={`w-8 h-8 rounded-lg flex items-center justify-center transition cursor-pointer ${
                 props.note?.isFavorite
                   ? "text-amber-500 hover:text-amber-600 bg-amber-50 dark:bg-amber-950/30"
@@ -1566,56 +1530,6 @@ export const NotesEditor: Component<NotesEditorProps> = (props) => {
                 </div>
               </Show>
             </div>
-
-            {/* Color Palette Popover */}
-            <div class="relative">
-              <button
-                type="button"
-                onClick={() => setShowPaletteMenu(!showPaletteMenu())}
-                data-testid="notes-editor-palette-btn"
-                title="Note color"
-                class="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
-              >
-                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
-                  <circle cx="12" cy="12" r="10" />
-                  <circle cx="12" cy="7" r="1.5" />
-                  <circle cx="16.5" cy="10.5" r="1.5" />
-                  <circle cx="16.5" cy="15.5" r="1.5" />
-                  <circle cx="7.5" cy="10.5" r="1.5" />
-                  <circle cx="7.5" cy="15.5" r="1.5" />
-                </svg>
-              </button>
-
-              <Show when={showPaletteMenu()}>
-                <div
-                  data-testid="notes-color-picker-menu"
-                  class="absolute left-0 top-full mt-1.5 p-2 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg flex items-center gap-1.5 z-30"
-                  onClick={(e) => e.stopPropagation()}
-                >
-                  <For each={NOTE_COLORS}>
-                    {(c) => (
-                      <button
-                        type="button"
-                        onClick={() => {
-                          setColor(c.id);
-                          props.onUpdateNote({ color: c.id });
-                          setShowPaletteMenu(false);
-                        }}
-                        title={c.name}
-                        data-testid={`notes-color-option-${c.id}`}
-                        class={`w-6 h-6 rounded-full border transition-transform hover:scale-110 cursor-pointer flex items-center justify-center ${
-                          c.swatchClass
-                        } ${color() === c.id ? "ring-2 ring-[#9E725F] ring-offset-1 scale-110" : ""}`}
-                      >
-                        <Show when={color() === c.id}>
-                          <span class="w-1.5 h-1.5 rounded-full bg-[#9E725F] dark:bg-[#D4A38F]" />
-                        </Show>
-                      </button>
-                    )}
-                  </For>
-                </div>
-              </Show>
-            </div>
           </div>
 
           {/* Right: Auto-save status + More Actions Menu */}
@@ -1907,7 +1821,7 @@ export const NotesEditor: Component<NotesEditorProps> = (props) => {
         <Show when={selectedImageEl()}>
           <div
             data-testid="image-floating-controls"
-            class="sticky top-0 z-30 px-3 py-1.5 bg-[#FAF9F5] dark:bg-[#1E2025] border-b border-[#E2DFD8] dark:border-[#2E3138] shadow-xs flex items-center justify-between gap-2 flex-wrap text-xs select-none"
+            class="sticky top-0 z-30 px-3 py-1.5 bg-white dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2E3138] shadow-xs flex items-center justify-between gap-2 flex-wrap text-xs select-none"
           >
             <div class="flex items-center gap-1 flex-wrap">
               {/* Category indicator */}
diff --git a/apps/webmail/src/components/notes/NotesList.tsx b/apps/webmail/src/components/notes/NotesList.tsx
index c097ef0..abefdd7 100644
--- a/apps/webmail/src/components/notes/NotesList.tsx
+++ b/apps/webmail/src/components/notes/NotesList.tsx
@@ -31,16 +31,12 @@ export const NotesList: Component<NotesListProps> = (props) => {
     setShowSortMenu(false);
   };
 
-  // Sort notes
+  // Sort notes (a flat list, matching the email list ΓÇö no pin grouping)
   const sortedNotes = createMemo(() => {
     const list = [...props.notes];
     const s = activeSort();
 
     return list.sort((a, b) => {
-      // Pinned notes always come first
-      if (a.isPinned && !b.isPinned) return -1;
-      if (!a.isPinned && b.isPinned) return 1;
-
       if (s === "title") {
         const titleA = (a.title || a.content || "").toLowerCase();
         const titleB = (b.title || b.content || "").toLowerCase();
@@ -54,18 +50,17 @@ export const NotesList: Component<NotesListProps> = (props) => {
     });
   });
 
-  const pinnedNotes = createMemo(() => sortedNotes().filter((n) => n.isPinned));
-  const unpinnedNotes = createMemo(() => sortedNotes().filter((n) => !n.isPinned));
-
   return (
     <div
       data-testid="notes-list-pane"
-      class={`w-full md:w-[320px] lg:w-[350px] md:min-w-[320px] lg:min-w-[350px] flex-shrink-0 border-r border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] flex flex-col min-h-0 h-full overflow-hidden select-none ${
+      class={`w-full h-full bg-white dark:bg-[#18191D] flex flex-col min-h-0 overflow-hidden select-none transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
+        props.selectedNote ? "border-r border-[#E2DFD8] dark:border-[#2E3138]" : ""
+      } ${
         props.class || ""
       }`}
     >
       {/* ΓöÇΓöÇ Top Header Bar ΓöÇΓöÇ */}
-      <div class="px-3.5 py-2.5 border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between gap-2 bg-[#FAF9F5]/70 dark:bg-[#18191D]/70 flex-shrink-0">
+      <div class="px-3.5 py-2.5 border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between gap-2 bg-white dark:bg-[#18191D] flex-shrink-0">
         <div class="flex items-center gap-2 min-w-0">
           {/* Mobile Categories Menu Toggle */}
           <Show when={props.onOpenMobileSidebar}>
@@ -198,7 +193,7 @@ export const NotesList: Component<NotesListProps> = (props) => {
 
       {/* ΓöÇΓöÇ Search Input (Collapsible or Active) ΓöÇΓöÇ */}
       <Show when={showSearchInput() || props.searchQuery}>
-        <div class="px-3 py-2 border-b border-[#E2DFD8] dark:border-[#2E3138] bg-[#FAF9F5] dark:bg-[#18191D] flex items-center gap-1.5 flex-shrink-0 animate-in fade-in duration-100">
+        <div class="px-3 py-2 border-b border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#18191D] flex items-center gap-1.5 flex-shrink-0 animate-in fade-in duration-100">
           <div class="relative flex-1">
             <input
               type="text"
@@ -240,41 +235,16 @@ export const NotesList: Component<NotesListProps> = (props) => {
             />
           }
         >
-          {/* Pinned Section */}
-          <Show when={pinnedNotes().length > 0}>
-            <div class="sticky top-0 z-10 px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider font-mono text-[#6F7173] dark:text-[#878A8E] bg-[#FAF9F5]/90 dark:bg-[#18191D]/90 backdrop-blur-xs border-b border-[#E2DFD8]/40 dark:border-[#2E3138]/40 flex items-center justify-between">
-              <span>PINNED</span>
-              <span class="text-[9px] font-mono tabular-nums">{pinnedNotes().length}</span>
-            </div>
-            <For each={pinnedNotes()}>
-              {(note) => (
-                <NotesListItem
-                  note={note}
-                  isSelected={props.selectedNote?.id === note.id}
-                  onSelect={props.onSelectNote}
-                />
-              )}
-            </For>
-          </Show>
-
-          {/* Unpinned Section */}
-          <Show when={unpinnedNotes().length > 0}>
-            <Show when={pinnedNotes().length > 0}>
-              <div class="sticky top-0 z-10 px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider font-mono text-[#6F7173] dark:text-[#878A8E] bg-[#FAF9F5]/90 dark:bg-[#18191D]/90 backdrop-blur-xs border-b border-[#E2DFD8]/40 dark:border-[#2E3138]/40 flex items-center justify-between">
-                <span>ALL NOTES</span>
-                <span class="text-[9px] font-mono tabular-nums">{unpinnedNotes().length}</span>
-              </div>
-            </Show>
-            <For each={unpinnedNotes()}>
-              {(note) => (
-                <NotesListItem
-                  note={note}
-                  isSelected={props.selectedNote?.id === note.id}
-                  onSelect={props.onSelectNote}
-                />
-              )}
-            </For>
-          </Show>
+          {/* Flat note list ΓÇö no pinned/unpinned sections */}
+          <For each={sortedNotes()}>
+            {(note) => (
+              <NotesListItem
+                note={note}
+                isSelected={props.selectedNote?.id === note.id}
+                onSelect={props.onSelectNote}
+              />
+            )}
+          </For>
         </Show>
       </div>
     </div>
diff --git a/apps/webmail/src/components/notes/NotesListItem.tsx b/apps/webmail/src/components/notes/NotesListItem.tsx
index 1cfa470..10737ae 100644
--- a/apps/webmail/src/components/notes/NotesListItem.tsx
+++ b/apps/webmail/src/components/notes/NotesListItem.tsx
@@ -1,12 +1,11 @@
 import { Component, Show, For } from "solid-js";
-import { NoteItem, NOTE_COLORS } from "./notesStore";
+import { NoteItem } from "./notesStore";
 import { formatMessageDate } from "../../utils/dateTime";
 
 export interface NotesListItemProps {
   note: NoteItem;
   isSelected: boolean;
   onSelect: (note: NoteItem) => void;
-  onTogglePin?: (e: MouseEvent, note: NoteItem) => void;
   onToggleFavorite?: (e: MouseEvent, note: NoteItem) => void;
 }
 
@@ -65,16 +64,6 @@ export const NotesListItem: Component<NotesListItemProps> = (props) => {
     return { done, total };
   };
 
-  const colorTheme = () => {
-    if (!props.note.color || props.note.color === "default") return null;
-    return NOTE_COLORS.find((c) => c.id === props.note.color) || null;
-  };
-
-  const getColorBorder = () => {
-    const found = colorTheme();
-    return found ? found.borderLight : "";
-  };
-
   return (
     <div
       role="button"
@@ -91,12 +80,10 @@ export const NotesListItem: Component<NotesListItemProps> = (props) => {
       class={`group relative w-full text-left p-3.5 transition-all duration-150 cursor-pointer select-none border-b border-[#E2DFD8]/60 dark:border-[#2E3138]/60 focus:outline-none ${
         props.isSelected
           ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-l-4 border-l-[#9E725F] dark:border-l-[#D4A38F]"
-          : colorTheme()
-          ? `${colorTheme()!.lightBg} ${colorTheme()!.darkBg} hover:opacity-95 border-l-4 border-l-transparent`
-          : "bg-white dark:bg-[#1E2025] hover:bg-[#F9F7F2] dark:hover:bg-[#26282E] border-l-4 border-l-transparent"
+          : "bg-white dark:bg-[#18191D] hover:bg-[#F9F7F2] dark:hover:bg-[#26282E] border-l-4 border-l-transparent"
       }`}
     >
-      {/* Top Row: Title, Date, Pin/Favorite status */}
+      {/* Top Row: Title, Date, Favorite status */}
       <div class="flex items-start justify-between gap-2 mb-1">
         <h4
           class={`text-sm font-semibold truncate leading-tight flex-1 ${
@@ -109,25 +96,7 @@ export const NotesListItem: Component<NotesListItemProps> = (props) => {
         </h4>
 
         <div class="flex items-center gap-1.5 flex-shrink-0">
-          {/* Pin Indicator */}
-          <Show when={props.note.isPinned}>
-            <span
-              title="Pinned note"
-              class="text-[#9E725F] dark:text-[#D4A38F] flex items-center"
-            >
-              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
-                <line x1="12" y1="17" x2="12" y2="22" stroke-linecap="round" />
-                <path
-                  d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"
-                  stroke-linecap="round"
-                  stroke-linejoin="round"
-                  fill="currentColor"
-                />
-              </svg>
-            </span>
-          </Show>
-
-          {/* Favorite Indicator */}
+          {/* Favorite Indicator (replaces the retired pin marker) */}
           <Show when={props.note.isFavorite}>
             <span
               title="Favorite note"
@@ -208,15 +177,6 @@ export const NotesListItem: Component<NotesListItemProps> = (props) => {
           </Show>
         </div>
 
-        {/* Note Color Indicator */}
-        <Show when={props.note.color && props.note.color !== "default"}>
-          <span
-            title={`Color: ${props.note.color}`}
-            class={`w-2.5 h-2.5 rounded-full flex-shrink-0 border border-black/10 dark:border-white/10 ${
-              NOTE_COLORS.find((c) => c.id === props.note.color)?.swatchClass || ""
-            }`}
-          />
-        </Show>
       </div>
     </div>
   );
diff --git a/apps/webmail/src/components/notes/NotesView.tsx b/apps/webmail/src/components/notes/NotesView.tsx
index 1805b05..d476ad7 100644
--- a/apps/webmail/src/components/notes/NotesView.tsx
+++ b/apps/webmail/src/components/notes/NotesView.tsx
@@ -11,7 +11,6 @@ import {
   restoreNoteFromBin,
   archiveNote,
   unarchiveNote,
-  togglePinNote,
   toggleFavoriteNote,
   duplicateNote,
   loadLabels,
@@ -81,10 +80,8 @@ export const NotesView: Component<NotesViewProps> = (props) => {
   const [sortOrder, setSortOrder] = createSignal<NoteSortOrder>("updated");
 
   // Mobile single-pane navigation flow: 'sidebar' | 'list' | 'editor'
-  // When on narrow mobile screens (< 768px), show the Notes sidebar first per spec
-  const [mobilePane, setMobilePane] = createSignal<"sidebar" | "list" | "editor">(
-    typeof window !== "undefined" && window.innerWidth < 768 ? "sidebar" : "list"
-  );
+  // Always default to 'list' on mobile ΓÇö the note list is the entry point, not the sidebar.
+  const [mobilePane, setMobilePane] = createSignal<"sidebar" | "list" | "editor">("list");
 
   // Modals state
   const [isEditLabelsOpen, setIsEditLabelsOpen] = createSignal(false);
@@ -157,8 +154,17 @@ export const NotesView: Component<NotesViewProps> = (props) => {
     };
     window.addEventListener("storage", handleStorageChange);
 
+    // Escape closes the mobile navigation drawer and returns to the note list.
+    const handleKeyDown = (e: KeyboardEvent) => {
+      if (e.key === "Escape" && mobilePane() === "sidebar") {
+        setMobilePane("list");
+      }
+    };
+    window.addEventListener("keydown", handleKeyDown);
+
     onCleanup(() => {
       window.removeEventListener("storage", handleStorageChange);
+      window.removeEventListener("keydown", handleKeyDown);
     });
   });
 
@@ -269,21 +275,23 @@ export const NotesView: Component<NotesViewProps> = (props) => {
     return notes().find((n) => n.id === id) || null;
   });
 
-  // Automatically select the first note if on desktop and none is selected
+  // Keep selectedNoteId valid when the filtered list changes.
+  // If the currently selected note disappears from the filtered list, deselect.
+  // Do NOT auto-select any note ΓÇö the editor only opens on an explicit click.
   createEffect(() => {
     const currentId = selectedNoteId();
+    if (!currentId) return;
     const currentList = searchFilteredNotes();
+    const exists = currentList.some((n) => n.id === currentId);
+    if (!exists) {
+      setSelectedNoteId(null);
+    }
+  });
 
-    // If current selected note doesn't exist in filtered list, select first available or null
-    if (currentId) {
-      const exists = currentList.some((n) => n.id === currentId);
-      if (!exists && currentList.length > 0) {
-        setSelectedNoteId(currentList[0].id);
-      } else if (!exists && currentList.length === 0) {
-        setSelectedNoteId(null);
-      }
-    } else if (currentList.length > 0 && typeof window !== "undefined" && window.innerWidth >= 768) {
-      setSelectedNoteId(currentList[0].id);
+  // With no selection there is no editor pane, so the phone view must stay on the list.
+  createEffect(() => {
+    if (!selectedNote() && mobilePane() === "editor") {
+      setMobilePane("list");
     }
   });
 
@@ -362,16 +370,6 @@ export const NotesView: Component<NotesViewProps> = (props) => {
     }
   }
 
-  function handleTogglePin() {
-    const n = selectedNote();
-    if (!n) return;
-    const mb = effectiveMailboxId();
-    const key =
-      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
-    togglePinNote(mb, n.id, key);
-    refreshAll();
-  }
-
   function handleToggleFavorite() {
     const n = selectedNote();
     if (!n) return;
@@ -511,11 +509,24 @@ export const NotesView: Component<NotesViewProps> = (props) => {
       data-testid="notes-view"
       class="flex flex-1 min-w-0 min-h-0 h-full overflow-hidden bg-[#F0EEE9] dark:bg-[#18191D] gap-0 sm:gap-2.5 lg:gap-3"
     >
-      {/* ΓöÇΓöÇ PANE 1: Notes Navigation Sidebar (256px desktop, full width mobile when mobilePane === 'sidebar') ΓöÇΓöÇ */}
+      {/* ΓöÇΓöÇ Mobile Navigation Backdrop (fades with the drawer, matches Mail/Calendar) ΓöÇΓöÇ */}
+      <div
+        data-testid="notes-mobile-nav-backdrop"
+        class={`fixed inset-0 bg-black/40 backdrop-blur-xs z-50 md:hidden transition-opacity duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
+          mobilePane() === "sidebar" ? "opacity-100" : "opacity-0 pointer-events-none"
+        }`}
+        onClick={() => setMobilePane("list")}
+        aria-hidden="true"
+      />
+
+      {/* ΓöÇΓöÇ PANE 1: Notes Navigation Sidebar (256px in-flow on desktop, sliding overlay drawer on mobile) ΓöÇΓöÇ */}
       <div
-        class={`${
-          mobilePane() === "sidebar" ? "block w-full" : "hidden"
-        } md:block md:w-64 md:min-w-[256px] md:max-w-[256px] flex-shrink-0 h-full`}
+        data-testid="notes-sidebar-shell"
+        class={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] flex-shrink-0 h-full transition-[translate,visibility] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
+          mobilePane() === "sidebar"
+            ? "translate-x-0 visible shadow-2xl"
+            : "-translate-x-full invisible"
+        } md:static md:visible md:translate-x-0 md:w-64 md:min-w-[256px] md:max-w-[256px] md:shadow-none md:transition-none`}
       >
         <NotesSidebar
           currentUser={props.currentUser}
@@ -548,11 +559,7 @@ export const NotesView: Component<NotesViewProps> = (props) => {
       </div>
 
       {/* ΓöÇΓöÇ Right Content Column beside NotesSidebar: TopFixedBar + 2-Pane Workspace Card ΓöÇΓöÇ */}
-      <div
-        class={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden gap-1.5 sm:gap-2 ${
-          mobilePane() === "sidebar" ? "hidden md:flex" : "flex"
-        }`}
-      >
+      <div class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden gap-1.5 sm:gap-2">
         {/* Top Fixed Bar (Beside NotesSidebar, not on top of it) */}
         <TopFixedBar
           activeModule={props.activeModule}
@@ -569,12 +576,16 @@ export const NotesView: Component<NotesViewProps> = (props) => {
         />
 
         {/* ΓöÇΓöÇ Main Three-Pane Container Card (Pane 2: List + Pane 3: Reading/Editing Panel) ΓöÇΓöÇ */}
-        <div class="flex-1 rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] shadow-2xs overflow-hidden flex min-w-0 min-h-0">
-          {/* ΓöÇΓöÇ PANE 2: Notes List (320pxΓÇô350px desktop, full width mobile when mobilePane === 'list') ΓöÇΓöÇ */}
+        <div class="flex-1 rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] shadow-2xs overflow-hidden flex min-w-0 min-h-0">
+          {/* ΓöÇΓöÇ PANE 2: Notes List (full-width alone, 320ΓÇô350px beside the editor) ΓöÇΓöÇ */}
           <div
             class={`${
-              mobilePane() === "list" ? "block w-full" : "hidden"
-            } md:block md:w-[320px] lg:w-[350px] md:min-w-[320px] lg:min-w-[350px] flex-shrink-0 h-full`}
+              mobilePane() === "list" ? "block" : "hidden"
+            } md:block h-full min-w-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
+              selectedNote()
+                ? "w-full md:w-[320px] lg:w-[350px] md:min-w-[320px] lg:min-w-[350px] md:max-w-[350px] md:flex-shrink-0"
+                : "w-full md:flex-1"
+            }`}
           >
             <NotesList
               notes={searchFilteredNotes()}
@@ -593,44 +604,45 @@ export const NotesView: Component<NotesViewProps> = (props) => {
             />
           </div>
 
-          {/* ΓöÇΓöÇ PANE 3: Reading and Editing Panel (Remaining Width desktop, full width mobile when mobilePane === 'editor') ΓöÇΓöÇ */}
-          <div
-            class={`${
-              mobilePane() === "editor" ? "block w-full" : "hidden"
-            } md:block md:flex-1 min-w-0 h-full`}
-          >
-            <NotesEditor
-              note={selectedNote()}
-              allLabels={labels()}
-              onUpdateNote={handleUpdateNote}
-              onTogglePin={handleTogglePin}
-              onToggleFavorite={handleToggleFavorite}
-              onDeleteNote={handleDeleteNote}
-              onDeleteForever={handleDeleteForever}
-              onRestoreFromBin={handleRestoreFromBin}
-              onArchiveNote={handleArchiveNote}
-              onUnarchiveNote={handleUnarchiveNote}
-              onDuplicateNote={handleDuplicateNote}
-              onOpenDrawingModal={() => {
-                setDrawingTargetNoteId(selectedNoteId());
-                setIsDrawingModalOpen(true);
-              }}
-              onOpenVersionHistory={() => {
-                setVersionHistoryTargetNote(selectedNote());
-                setIsVersionHistoryOpen(true);
-              }}
-              onUploadImage={handleUploadImage}
-              onRemoveImage={handleRemoveImage}
-              onRemoveDrawing={handleRemoveDrawing}
-              resolveMediaUri={resolveMedia}
-              saveStatus={saveStatus()}
-              saveErrorMessage={saveErrorMessage()}
-              syncStatus={syncStatus()}
-              onBackToNotesList={() => setMobilePane("list")}
-              onNewNote={handleNewNote}
-              onShareViaMail={props.onShareViaMail}
-            />
-          </div>
+          {/* ΓöÇΓöÇ PANE 3: Reading and Editing Panel ΓÇö mounted only when a note is open, like the mail reading pane ΓöÇΓöÇ */}
+          <Show when={selectedNote()}>
+            <div
+              class={`${
+                mobilePane() === "editor" ? "block" : "hidden"
+              } md:flex md:flex-1 min-w-0 h-full transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`}
+            >
+              <NotesEditor
+                note={selectedNote()}
+                allLabels={labels()}
+                onUpdateNote={handleUpdateNote}
+                onToggleFavorite={handleToggleFavorite}
+                onDeleteNote={handleDeleteNote}
+                onDeleteForever={handleDeleteForever}
+                onRestoreFromBin={handleRestoreFromBin}
+                onArchiveNote={handleArchiveNote}
+                onUnarchiveNote={handleUnarchiveNote}
+                onDuplicateNote={handleDuplicateNote}
+                onOpenDrawingModal={() => {
+                  setDrawingTargetNoteId(selectedNoteId());
+                  setIsDrawingModalOpen(true);
+                }}
+                onOpenVersionHistory={() => {
+                  setVersionHistoryTargetNote(selectedNote());
+                  setIsVersionHistoryOpen(true);
+                }}
+                onUploadImage={handleUploadImage}
+                onRemoveImage={handleRemoveImage}
+                onRemoveDrawing={handleRemoveDrawing}
+                resolveMediaUri={resolveMedia}
+                saveStatus={saveStatus()}
+                saveErrorMessage={saveErrorMessage()}
+                syncStatus={syncStatus()}
+                onBackToNotesList={() => setMobilePane("list")}
+                onNewNote={handleNewNote}
+                onShareViaMail={props.onShareViaMail}
+              />
+            </div>
+          </Show>
         </div>
       </div>
```

## Test suite output

Command: `npx tsx --experimental-wasm-modules src/run_test.node.js` (from `apps/webmail/`, exit code 0; `npm test` runs the same script).

```
(node:8228) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[Worker Crypto] Decryption failed for attachment_id=f4742eab-9121-4c63-845e-bc71fd966d63 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[Worker Crypto] Hash mismatch for attachment_id=86a46efa-2d6e-4f99-8ea7-77a42599426a (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
  ✓ test_attachment_hash_mismatch_marks_corrupted: tampered content hash marks attachment corrupted without producing partial output
  ✓ test_attachment_empty_file_roundtrip: 0-byte file encrypt, upload, download, decrypt returns 0-byte file and no error
  ✓ test_attachment_unicode_filename_roundtrip: non-ASCII unicode filename round-trips byte-for-byte
  ✓ test_attachment_full_flow_roundtrip: key gen -> chunk -> encrypt -> mock upload -> mock download -> decrypt -> hash-match
  ✓ test_wasm_unavailable_throws_not_falls_back: wrapAttachmentContentKey and unwrapAttachmentContentKey throw when WASM is unavailable
  ✓ Content key generation produces 32 bytes
  ✓ Base IV generation produces 12 bytes
  ✓ Chunk IV generation produces 12 bytes
  ✓ Attachment encryption roundtrip: 1 byte
  ✓ Attachment encryption roundtrip: 64 bytes
[Worker Crypto] Decryption failed for attachment_id=6c0b8dae-eecd-45e9-aa88-3673e7003903 chunk_index=0
  ✓ Path A recipient cannot decrypt sender chunks
  ✓ Protocol v2 golden test vectors match Rust crypto-core
  ✓ Protocol v2 owner encrypt/decrypt + outbound grant roundtrip + tamper rejection
ATTACHMENT CRYPTO TESTS: 22 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
  ✓ Added Account A to storage
  ✓ Added Account B, total accounts is 2
  ✓ Account B is promoted to front
  ✓ Re-syncing Account A does not duplicate
  ✓ Account A is promoted back to front
  ✓ Selective logout removes only Account B
  ✓ Origin 127.0.0.1 overrides mismatched server RP ID 'localhost'
  ✓ Origin localhost overrides mismatched server RP ID '127.0.0.1'
  ✓ Custom domain preserves server RP ID suffix
  ✓ test_login_clears_prior_accounts: localStorage contains ONLY Account C (prior accounts cleared)
  ✓ test_login_clears_prior_accounts: sessionStorage contains ONLY Account C
  ✓ test_login_clears_prior_accounts: prior Account A keys are wiped
  ✓ test_login_clears_prior_accounts: prior Account B keys are wiped
  ✓ test_login_clears_prior_accounts: new generation marker active
  ✓ test_startup_validates_tokens: invalid Account B is filtered out before render
  ✓ test_startup_validates_tokens: keys for invalid Account B are purged
  ✓ test_logout_clears_all_keys_for_account: all keys and publication records cleared for logged-out Account A
  ✓ test_logout_clears_all_keys_for_account: Account B keys remain intact
  ✓ test_logout_all_clears_everything: all sensitive byos_* keys are cleared
  ✓ test_logout_all_clears_everything: session generation marker removed from both storages
  ✓ test_logout_all_clears_everything: non-sensitive preference preserved
  ✓ test_tokens_eliminated_from_browser_storage: sessionToken is NOT in sessionStorage
  ✓ test_tokens_eliminated_from_browser_storage: sessionToken is NOT in localStorage
  ✓ test_tokens_eliminated_from_browser_storage: mailboxSkHex is NOT in sessionStorage
  ✓ test_tokens_eliminated_from_browser_storage: mailboxSkHex is NOT in localStorage
  ✓ test_tokens_eliminated_from_browser_storage: non-secret display metadata is preserved
  ✓ test_expired_token_shows_specific_error: error message names the specific account
  ✓ test_expired_token_shows_specific_error: does not show generic unauthorized error
  ✓ test_expired_token_shows_specific_error: expired account is removed from sidebar
  ✓ test_expired_token_shows_specific_error: storage updated without expired account
  ✓ test_switch_loads_target_account_keys: initially on Account A signing seed
  ✓ test_switch_loads_target_account_keys: target account keys exist in store
  ✓ test_switch_loads_target_account_keys: active signing seed is B's after switch, not A's
  ✓ test_switch_loads_target_account_keys: active signing seed does not match A
  ✓ test_switch_unlocks_if_locked: unlock prompt appears when switching to locked account
  ✓ test_switch_unlocks_if_locked: switch does not proceed while account is locked
  ✓ test_switch_unlocks_if_locked: switch completes after unlock succeeds
  ✓ test_switch_unlocks_if_locked: active keys are loaded after unlock
  ✓ test_switch_does_not_clear_other_account_keys: Account B keys successfully resolved
  ✓ test_switch_does_not_clear_other_account_keys: Account A mailbox key intact in sessionStorage
  ✓ test_switch_does_not_clear_other_account_keys: Account A signing seed intact in sessionStorage
  ✓ test_switch_does_not_clear_other_account_keys: Account A X-Wing seed intact in sessionStorage
  ✓ test_send_after_switch_signs_with_correct_seed: send resolves Account B signing seed
  ✓ test_send_after_switch_signs_with_correct_seed: send does NOT use Account A signing seed
  ✓ test_decrypt_after_switch_uses_correct_key: decrypt uses Account B mailbox key
  ✓ test_decrypt_after_switch_uses_correct_key: decrypt does NOT use Account A mailbox key
  ✓ test_compose_from_dropdown_controls_signing_key: outgoing mailbox ID is driven by From: dropdown
  ✓ test_compose_from_dropdown_controls_signing_key: signing seed is B's, not A's sidebar seed
  ✓ test_compose_from_dropdown_controls_signing_key: signing seed does not match sidebar selection
  ✓ test_multi_account_server_managed_linking: secondary account registered in session accounts list
  ✓ test_multi_account_server_managed_linking: no bearer tokens in sessionStorage connected accounts
  ✓ test_multi_account_server_managed_linking: no tokens or secrets in localStorage display list
  ✓ test_account_switching_uses_non_secret_selector: active context initialized to Account A
  ✓ test_account_switching_uses_non_secret_selector: active context switched to Account B via non-secret selector
  ✓ test_account_switching_uses_non_secret_selector: selector is plain mailbox ID
  ✓ test_account_selector_cannot_act_as_credential: authorized Account A is accepted
  ✓ test_account_selector_cannot_act_as_credential: authorized Account B is accepted
  ✓ test_account_selector_cannot_act_as_credential: unauthorized/forged mailbox selector is rejected
  ✓ test_account_selector_cannot_act_as_credential: arbitrary mailbox ID fails closed
  ✓ test_comprehensive_storage_token_absence: zero tokens detected across localStorage and sessionStorage
  ✓ test_account_removal_clears_keys_and_unlinks: Account B keys unsealed in memory
  ✓ test_account_removal_clears_keys_and_unlinks: Account B removed from account list
  ✓ test_account_removal_clears_keys_and_unlinks: Account B keys wiped from memory
  ✓ test_account_removal_clears_keys_and_unlinks: Account B keys wiped from sessionStorage
  ✓ test_search_key_in_memory_custody_and_storage_absence: searchKey retrievable from in-memory custody
  ✓ test_search_key_in_memory_custody_and_storage_absence: byos_mailbox_skey_* is absent from sessionStorage
  ✓ test_zeroize_keys_clears_search_key: searchKey wiped from in-memory custody
  ✓ test_zeroize_keys_clears_search_key: byos_mailbox_skey_* swept from storage
  ✓ test_keys_published_contains_no_private_material: published record contains only '1' flag
  ✓ test_keys_published_contains_no_private_material: clearAccountKeys successfully removes publication record
MULTI ACCOUNT TESTS: 70 passed, 0 failed

Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 1 passed, 0 failed

Running Path A Compose Tests...
Running Path A Compose & tryPathASend Tests...
  ✓ 1. tryPathASend returns fallback on 404 lookup
  ✓ 2. tryPathASend returns fallback on network error during lookup
Recipient has no usable X-Wing key; using Path B
  ✓ 3. tryPathASend returns fallback when record has no xwing_public_key
Recipient X-Wing key has wrong length; using Path B
  ✓ 4. tryPathASend returns fallback when xwing_public_key has wrong length
  ✓ 5. tryPathASend returns sent on successful submission
  ✓ 6. tryPathASend returns failed when server rejects envelope
  ✓ 7. tryPathASend returns failed when local WASM throws
  ✓ 8. buildMimeString produces valid plain MIME and multipart MIME
  ✓ 9. tryPathASend with senderXwingSeed produces sender_envelope_json in send payload
  ✓ 10. test_path_a_send_with_attachments_signs_correct_payload: signed byte range is identical with and without attachments
PATH A COMPOSE TESTS: 10 passed, 0 failed

Running Path A Read Tests...
Running Path A Read & Signature Verification Tests...
  ✓ 1. decryptPathAEnvelope returns plaintext + verified=true on the Rust vector
  ✓ 2. Returns verified=false when signature is tampered
  ✓ 3. Returns verified=false when sender has no ed25519 key in directory
  ✓ 4. Throws when envelope JSON is malformed
  ✓ 5. Throws when recipient seed is wrong length
  ✓ 6. Handles empty string envelope gracefully
  ✓ 7. extractCleanEmail extracts RFC and plain addresses correctly
  ✓ 8. decryptPathAEnvelope handles unknown_mailbox error with a friendly message
  ✓ 9. test_decrypt_failure_surfaces_real_error: surfaces step name and underlying error, never 'unknown'
PATH A READ TESTS: 9 passed, 0 failed

Running MIME Parser Tests...
Running MIME Parser Tests...
  ✓ 1. Simple text/plain message — textPlain extracted, headers stripped
  ✓ 2. Simple text/html message — textHtml extracted
  ✓ 3. multipart/alternative with plain+html — both extracted
  ✓ 4. multipart/alternative with only html — html only
  ✓ 5. Multipart with quoted boundary and nested parts
  ✓ 6. Malformed input (no headers) — falls back to treating whole input as plaintext
  ✓ 7. Real message with tracked pixel in HTML part — parsed correctly
  ✓ 8. Direct text/calendar MIME message extracts calendarPart and method
  ✓ 9. multipart/alternative with plain, html, and calendar
  ✓ 10. Inline BEGIN:VCALENDAR fallback in plaintext
  ✓ 11. buildMimeString includes Cc and Bcc headers when provided
MIME PARSER TESTS: 11 passed, 0 failed

Running Signature Tests...
Running Signature Tests...
  ✓ 1. loadSignature returns stored plaintext
  ✓ 2. loadSignatureHtml returns stored HTML
  ✓ 3. loadSignatureHtml falls back to plaintext conversion when HTML is absent
  ✓ 4. saveSignature with empty string removes the key
  ✓ 5. saveSignatureHtml with empty string removes the key
  ✓ 6. clearSignature removes both keys
  ✓ 7. applySignature appends signature to plaintext
  ✓ 8. applySignatureHtml appends byos-signature div to HTML
  ✓ 9. Server hydration writes both keys to localStorage
  ✓ 10. Server hydration with empty signature_html removes the key
  ✓ 11. Server hydration with only signature_plain leaves signature_html absent
SIGNATURE TESTS: 11 passed, 0 failed

Running Reply Signature Tests...
Running Reply Signature Tests...
  ✓ 1. TestReplyPrePopulatesSignature
  ✓ 2. TestForwardPrePopulatesSignature
  ✓ 3. TestNewComposePrePopulatesSignature
  ✓ 4. TestSendDoesNotDoubleAppend
  ✓ 5. TestNewComposeDefaultsToActiveMailbox
  ✓ 6. TestClearComposeFormResetsComposeAccountId
REPLY SIGNATURE TESTS: 6 passed, 0 failed

Running Mbox Stream Tests...
Running Mbox Stream Tests...
  ✓ 1. Parse a 3-message mbox -> yields 3 messages in order
  ✓ 2. Message boundary detection works with CRLF
  ✓ 3. Message boundary detection works with LF only
  ✓ 4. mboxrd unescaping works (>From -> From)
  ✓ 5. A very large message (simulate 2MB) yields correctly
  ✓ 6. AbortSignal stops iteration cleanly
  ✓ 7. Custom .mbox import encryption pipeline (AES-GCM zero-knowledge roundtrip)
MBOX STREAM TESTS: 7 passed, 0 failed

Running Mbox Labels Tests...
Running Mbox Labels Tests...
  ✓ 1. X-Gmail-Labels with "Sent" -> "sent"
  ✓ 2. X-Gmail-Labels with "Spam" -> "spam"
  ✓ 3. X-Gmail-Labels with "Inbox,Important" -> "inbox"
  ✓ 4. X-Gmail-Labels with "Archive" only -> "archive"
  ✓ 5. No X-Gmail-Labels + From matches user email -> "sent"
  ✓ 6. No X-Gmail-Labels + From != user email -> null
  ✓ 7. Priority: message with both "Inbox" and "Spam" -> "spam" (spam wins)
  ✓ 8. Priority: message with both "Trash" and "Sent" -> "trash"
MBOX LABELS TESTS: 8 passed, 0 failed

Running Import Queue Tests...
Running Import Queue Tests...
  ✓ 1. Concurrency limit is respected
Import worker error on item 1: Error: Simulated upload error
    at <anonymous> (F:\Codex\byos-email\apps\webmail\src\import_queue.test.ts:60:17)
    at runWorker (F:\Codex\byos-email\apps\webmail\src\import_queue.ts:51:15)
    at async Promise.all (index 1)
    at async runWithConcurrency (F:\Codex\byos-email\apps\webmail\src\import_queue.ts:68:3)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\import_queue.test.ts:55:5)
    at async test (F:\Codex\byos-email\apps\webmail\src\import_queue.test.ts:15:7)
    at async runImportQueueTests (F:\Codex\byos-email\apps\webmail\src\import_queue.test.ts:51:3)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:155:26)
  ✓ 2. Continues when item worker throws
  ✓ 3. onProgress tracks completed and total accurately
IMPORT QUEUE TESTS: 3 passed, 0 failed

Running Conversation Threading Tests...
Running Conversation Threading Tests...
  ✓ 1. TestThreadRowRendersParticipantLabel
  ✓ 2. TestThreadRowShowsUnreadBold
  ✓ 3. TestFetchThreadsFunctionCallsCorrectURL
  ✓ 4. TestToggleMessageStarCallsCorrectURL
  ✓ 5. TestThreadSnoozeFiltering
  ✓ 6. TestThreadMultiSelectHelpers
CONVERSATION THREADING TESTS: 6 passed, 0 failed

Running Undo Send Tests...
Running Undo Send Tests...
  ✓ 1. TestPrepareSendPayloadEmptyRecipient
  ✓ 2. TestPrepareSendPayloadAppliesSignature
  ✓ 3. TestRestoreComposeFromPayload
  ✓ 4. TestUndoRemovesPendingSend
  ✓ 5. TestCcBccPendingSendPayloadAndRestore
UNDO SEND TESTS: 5 passed, 0 failed

Running Keyboard Shortcuts Tests...
Running Keyboard Shortcuts Tests...
  ✓ 1. isTextInputElement returns true for input, textarea, contenteditable
  ✓ 2. isTextInputElement returns false for div, button, body
  ✓ 3. matchShortcut matches plain keys correctly
  ✓ 4. matchShortcut respects shift, ctrl, meta modifiers
  ✓ 5. matchShortcut rejects when shift state mismatches
KEYBOARD SHORTCUTS TESTS: 5 passed, 0 failed

Running Snooze Tests...
Running Snooze Tests...
  ✓ 1. TestSnoozePresetsComputeCorrectTimes
  ✓ 2. TestFormatSnoozeTime
SNOOZE TESTS: 2 passed, 0 failed

Running Scheduled Folder Tests...
Running Scheduled Folder Tests...
  ✓ 1. Folder type union includes 'scheduled'
  ✓ 2. Sidebar folder list order places 'scheduled' between 'sent' and 'drafts'
  ✓ 3. MessageRow formatSmartDate formats scheduled dates correctly
  ✓ 4. DisplayMessage folder supports 'scheduled'
  ✓ 5. Scheduled message error placeholders conform to specification
  ✓ 6. Folder threading support accurately distinguishes flat-by-design folders
  ✓ 7. Edit then discard leaves scheduled item untouched
  ✓ 8. Edit then save with body change updates same row in place
  ✓ 9. Edit then save with time change updates send_at on same row
  ✓ 10. Edit then save with no changes preserves all attributes without orphan drafts
  ✓ 11. Failed schedule surfaces specific backend error step, not generic wrapper
  ✓ 12. Schedule send with locked mailbox key surfaces actionable unlock message
  ✓ 13. Real-time event message.deleted removes scheduled item from list live
  ✓ 14. Real-time event message.created adds delivered sent copy to Sent folder live
  ✓ 15. Delivery failure event moves message to Drafts with sendFailed marker live
SCHEDULED FOLDER TESTS: 15 passed, 0 failed

Running Display Party Tests...
Running Display Party & Sent Folder Tests...
  ✓ 1. formatAddress extracts clean display name or email
  ✓ 2. Inbox row renders sender, not recipient
  ✓ 3. Archive, spam, trash, and search rows render sender
  ✓ 4. Sent row renders recipient, not sender
  ✓ 5. Sent row with multiple recipients renders first +N
  ✓ 6. Drafts row with no recipient renders 'No recipient'
  ✓ 7. Scheduled folder renders recipient(s) and first +N
  ✓ 8. Threaded Sent row renders the recipient of the latest message
  ✓ 9. Sent folder rows are never treated as unread
  ✓ 10. Sender Display Logic: shows display name if available, else clean email
  ✓ 11. Mailbox Unlock Persistence Across Refresh preserves keys in session vault
  ✓ 12. Participant Deduplication, Current User formatting, and Address-Level Resolution
  ✓ 13. Compose Recipient Auto-Suggestion & Candidate Resolution
DISPLAY PARTY TESTS: 13 passed, 0 failed

Running Nested Labels Tests...
  PASS: test_sidebar_renders_tree
  PASS: test_parent_click_filters_descendants
  PASS: test_expand_state_persists
  PASS: test_reparent_cycle_blocked_ui
NESTED LABELS TESTS: 4 passed, 0 failed

Running API Error Handling Tests...
Running API Error Handling Tests...
  ✓ test_api_error_propagates_not_swallowed: fetchMailboxes throws on 500
  ✓ test_api_error_propagates_not_swallowed: fetchDrafts, fetchFolders, fetchLabels, fetchContacts throw on 500
  ✓ test_successful_return_shape: api client returns data on 200
  ✓ test_global_error_banner_renders: set and clear global error signal
API ERROR HANDLING TESTS: 4 passed, 0 failed

Running Unified Inbox Tests...
Running Unified Inbox Tests...
  ✓ test_unified_inbox_merges_accounts
  ✓ test_account_chip_renders
  ✓ test_reply_uses_message_account
  ✓ test_unified_search_deduplicates
  ✓ test_snooze_uses_correct_account_endpoint
  ✓ test_multi_sse_routing
  ✓ test_account_chip_shows_current_selection
  ✓ test_dropdown_lists_all_accounts
  ✓ test_selecting_account_updates_folders
  ✓ test_selecting_all_inboxes_shows_aggregate
  ✓ test_account_chip_color_matches_selection
  ✓ test_key_resolution_uses_owning_mailbox
  ✓ test_key_locked_prompts_for_correct_account
  ✓ test_unlock_retries_decrypt
  ✓ test_global_key_signal_never_used_in_unified_path
  ✓ test_popup_hides_all_inboxes_with_one_account
  ✓ test_popup_shows_all_inboxes_with_two_accounts
  ✓ test_popup_shows_all_inboxes_with_three_accounts
  ✓ test_selection_resets_on_account_removal
UNIFIED INBOX TESTS: 19 passed, 0 failed

Running Masked Email Tests...
Running Masked Email Tests...
  ✓ 1. TestBuildMimeStringIncludesAliasHeaders
  ✓ 2. TestBuildPendingSendPayloadWithFromAlias
  ✓ 3. TestRestoreComposeStateWithFromAlias
  ✓ 4. TestMaskedAliasAPIFunctions
  ✓ 5. TestMaskedAliasRateLimitErrorHandling
  ✓ 6. TestMessageMetadataReplyViaAlias
  ✓ 7. test_custom_alias_validation_shows_errors
  ✓ 8. test_custom_alias_preview_updates
  ✓ 9. test_custom_alias_409_shows_friendly_error
  ✓ 10. test_random_mode_hides_custom_input
  ✓ 11. TestCreateCustomAliasAPI
MASKED EMAIL TESTS: 11 passed, 0 failed

Running Focused Inbox Tests...
Running Focused Inbox Classifier Tests...
  ✓ 1. TestPrimaryClassificationForDirectHumanMail
  ✓ 2. TestNewslettersClassificationHeaders
  ✓ 3. TestSocialClassificationForSocialDomains
  ✓ 4. TestTransactionalAndNotificationsClassifyIntoPrimary
  ✓ 5. TestClassificationPrecedenceOrder
  ✓ 6. TestOverridesPrecedence
FOCUSED INBOX TESTS: 6 passed, 0 failed

Running Offline Support Tests...
  ✓ 1. Cache stores 50 messages, prunes older
  ✓ 2. Cached content is ciphertext, not plaintext
  ✓ 3. Unsealed keys NOT present in IndexedDB
  ✓ 4. Send queue persists items with client_queue_id UUID
  ✓ 5. Queue replay sends items in FIFO order
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000005: Error: invalid recipient rejected by server
    at sendInternal (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:387:17)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:414:17)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:382:7)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:207:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:364:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:227:22)
  ✓ 6. Replay handles server 200 (removes item) and server error (marks failed)
  ✓ 8. Release B Replay: Successful replay drains queue and reports sent count
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000020: Error: API error 400: attachment not found
    at Object.sendOutbound (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:446:23)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:420:24)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:444:19)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:207:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:434:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:227:22) {
  status: 400
}
  ✓ 9. Release B Replay: Permanent HTTP 400 rejection marks failed, preserves data, and skips future auto-replay
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000030: Error: API error 503: Service Unavailable
    at sendInternal (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:488:23)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:414:17)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:485:19)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:207:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:467:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:227:22) {
  status: 503
}
  ✓ 10. Release B Replay: Temporary HTTP 503 failure keeps pending status and records attempt without marking failed
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000040: TypeError: Failed to fetch
    at sendInternal (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:528:17)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:414:17)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:525:19)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:207:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:507:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:227:22)
  ✓ 11. Release B Replay: Network disconnection during replay keeps pending status for automatic retry
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000050: Error: API error 400: bad payload
    at sendInternal (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:555:25)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:414:17)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:552:7)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:207:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:541:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:227:22) {
  status: 400
}
  ✓ 12. Release B Replay: Manual retry succeeds after correcting underlying issue
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000060: Error: API error 413: outbound_attachment_limit_exceeded
    at Object.sendOutbound (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:610:23)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:420:24)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:608:7)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:207:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:582:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:227:22) {
  status: 413
}
  ✓ 13. Release B Replay: Queue persistence after failed replay preserves attachments and metadata
  ✓ 14. Release B Error Classification: Unit classification of 400, 401, 403, 408, 409, 429, 500, and network errors
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000070: Error: API error 429: Too Many Requests
    at sendInternal (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:696:23)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:414:17)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:693:20)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:207:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:682:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:227:22) {
  status: 429,
  retryAfter: 60
}
  ✓ 15. Release B Replay: HTTP 429 with Retry-After delays subsequent replay passes until elapsed
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000080: Error: API error 408: Request Timeout
    at sendInternal (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:753:23)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:414:17)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:751:19)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:207:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:741:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:227:22) {
  status: 408
}
  ✓ 16. Release B Replay: HTTP 408 Request Timeout is handled as recoverable transient failure
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000091: Error: API error 401: Unauthorized
    at sendInternal (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:793:25)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:414:17)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:789:25)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:207:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:768:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:227:22) {
  status: 401
}
  ✓ 17. Release B Replay: HTTP 401 session expiration holds messages pending and succeeds upon reauthentication
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000100: Error: API error 409: outbound_key_epoch_expired
    at Object.sendOutbound (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:844:23)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:420:24)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:841:19)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:207:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:830:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:227:22) {
  status: 409,
  code: 'outbound_key_epoch_expired'
}
  ✓ 18. Release B Replay: HTTP 409 Conflict without recovery procedure transitions to failed without infinite retry loops
  ✓ 7. Clear offline cache deletes all stores and SW caches
OFFLINE SUPPORT TESTS: 18 passed, 0 failed

Running Composer Sanitizer Tests...
Running Composer Sanitizer Tests...
  ✓ test_sanitize_strips_script_tags
  ✓ test_sanitize_strips_onclick_handlers
  ✓ test_sanitize_strips_javascript_hrefs
  ✓ test_sanitize_allows_safe_tags
  ✓ test_sanitize_allows_byos_storage_images
  ✓ test_sanitize_blocks_remote_images_by_default
  ✓ test_sanitize_preserves_table_structure
  ✓ test_sanitize_preserves_code_blocks
  ✓ test_paste_from_word_strips_wrapper_html
  ✓ test_sanitize_does_not_leak_hooks_across_calls
COMPOSER SANITIZER TESTS: 10 passed, 0 failed

Running Contacts Management Tests...
Running Contacts Management & Autocomplete Tests...
  ✓ test_contact_list_renders
  ✓ test_contact_search_filters
  ✓ test_contact_create_validates_email
  ✓ test_contact_delete_confirms
  ✓ test_autocomplete_shows_matches
  ✓ test_autocomplete_adds_chip
  ✓ test_autocomplete_deduplicates
CONTACTS MANAGEMENT TESTS: 7 passed, 0 failed

Running Sidebar Borderless Tests...
Running Sidebar Borderless Tests...
  ✓ test_sidebar_has_no_border
  ✓ test_sidebar_and_main_share_background
SIDEBAR BORDERLESS TESTS: 2 passed, 0 failed

Running Profile Photo Tests...
Running Profile Photo & Avatar Tests...
  ✓ test_fallback_avatar_renders_initial_and_color
  ✓ test_sidebar_renders_photo_when_set
  ✓ test_sidebar_renders_fallback_when_no_photo
  ✓ test_photo_crypto_roundtrip
PROFILE PHOTO TESTS: 4 passed, 0 failed

Running Persistent Session Tests...
Running Persistent Session Tests...
  ✓ 1. Device key is non-extractable AES-GCM 256-bit
  ✓ 2. Key sealing and unsealing roundtrip preserves all sensitive fields
  ✓ 3. Tampered ciphertext rejects decryption
  ✓ 4. Full lifecycle: savePersistentSession, restorePersistentSession, clearPersistentSession
[persistent-session] Token has expired. Purging persistent session.
  ✓ 5. Expired token rejects restoration and purges storage
[persistent-session] Token rejected by server (HTTP 401). Purging persistent session.
  ✓ 6. Server rejection (401 revoked) rejects restoration and purges storage
  ✓ 7. Plaintext passkey vault remediation: purges legacy entries and forbids plaintext storage
  ✓ 8. Separation between passkey authentication and mailbox decryption
PERSISTENT SESSION TESTS: 8 passed, 0 failed

Running OAuth Import Tests...
  ✓ encryptTokenPayload and decryptTokenPayload round-trip
  ✓ Tampered token ciphertext is rejected by decryptTokenPayload
  ✓ encryptRawEml generates Section 12 AES-GCM envelope
  ✓ parseRfc822Headers extracts From, To, Cc, Subject, Date, and attachments
  ✓ fetchWithBackoff respects 429 Retry-After header
  ✓ fetchWithBackoff aborts immediately when signal triggered
OAUTH IMPORT TESTS: 6 passed, 0 failed

Running Calendar Recurrence (RRULE) Tests...
  ✓ parseRRule parses simple DAILY rule
  ✓ parseRRule parses WEEKLY with BYDAY and COUNT
  ✓ buildRRuleString formats correctly
  ✓ expandEventOccurrences expands DAILY within window
  ✓ expandEventOccurrences respects COUNT limit
  ✓ expandEventOccurrences suppresses cancelled occurrence
  ✓ expandEventOccurrences replaces modified occurrence with exception details
  ✓ expandEventOccurrences handles weekly BYDAY with exceptions
CALENDAR RRULE TESTS: 8 passed, 0 failed

Running Calendar Crypto Tests...
  ✓ encrypt and decrypt roundtrip preserves all event metadata
[calendar_crypto] Decryption failed: decryption failed
  ✓ tampered ciphertext fails decryption gracefully with safe placeholder
[calendar_crypto] Decryption failed: decryption failed
  ✓ wrong mailbox key fails decryption safely
  ✓ encryptCalendarEventPayload throws on missing or null key (fails closed)
  ✓ encryptCalendarEventPayload throws on invalid key length (fails closed)
  ✓ encryptCalendarEventPayload throws on missing mailboxId (fails closed)
  ✓ encryptCalendarEventPayload throws on WASM failure (never falls back to plaintext)
[calendar_crypto] Refusing to interpret unencrypted or legacy JSON payload as decrypted ciphertext
  ✓ decryptCalendarEventPayload refuses to interpret legacy Base64 JSON as decrypted
[calendar_crypto] Decryption failed: decryption failed
  ✓ decryptCalendarEventPayload fails closed on cross-mailbox AAD mismatch
  ✓ classifyCalendarPayload accurately identifies envelope vs legacy JSON vs unknown
CALENDAR CRYPTO TESTS: 10 passed, 0 failed

Running Calendar ICS & Invitation Tests...
Running Calendar ICS & Invitation Tests...
  ✓ unescapeIcsText handles commas, semicolons, backslashes, and newlines
  ✓ escapeIcsText escapes special characters
  ✓ foldIcsLine folds lines > 75 characters
  ✓ parseIcsDate parses UTC and all-day dates
  ✓ cleanEmail strips mailto: and angle brackets
  ✓ generateIcs and parseIcs full roundtrip with attendees and organizer
  ✓ generateRsvpReplyIcs formats RFC 5546 iTIP reply
  ✓ parseIcs safely handles malformed, truncated, or empty input
  ✓ Distinguish invitation (METHOD:REQUEST) from ordinary published calendar
  ✓ 9. Organizer update increments sequence and retains stable UID
  ✓ 10. Stale update rejected: incoming revision older than stored revision
  ✓ 11. Organizer mismatch rejected by verifyInvitationAuthenticity
  ✓ 12. Duplicate RSVP response detected without duplicate side-effects
  ✓ 13. Cancellation followed by older REQUEST is rejected
  ✓ 14. Single-instance recurrence exception (RECURRENCE-ID) parsed
  ✓ 15. Timezone-aware timestamp and Daylight-Saving transition
  ✓ 16. Parser resilience: reject oversized input (>512KB)
  ✓ 17. Parser resilience: sanitize dangerous URL schemes (javascript:)
  ✓ 18. Parser resilience: sanitize ASCII control characters
  ✓ 19. Parser resilience: duplicate UID property takes first valid UID
  ✓ 20. RFC 6047 MIME fixtures roundtrip for REQUEST, REPLY, CANCEL
  ✓ 21. BYOS policy: negative SEQUENCE rejected as invalid input (not a stale-revision check)
  ✓ 22. Full stale REQUEST lifecycle: seq3 stored → seq2 rejected → seq4 accepted → dup seq4 idempotent → old CANCEL rejected → valid CANCEL accepted
  ✓ 23. REPLY method: attendee response with organizer's sequence is accepted, not treated as stale
  ✓ 24. REQUEST updates v0 → v1 → v2 accepted by verifyInvitationAuthenticity at each step
  ✓ 25. CANCEL sequence must exceed stored REQUEST sequence
  ✓ 26. Recurring event: RECURRENCE-ID parsed; stale exception rejected; fresh exception accepted
  ✓ 27. Organizer authorization: pipeline integration — stored organizer blocks hijack, correct organizer proceeds
  ✓ generateIcs exports multi-component series with EXDATE and detached VEVENT exceptions
  ✓ VTIMEZONE parsing extracts standard and daylight definitions
  ✓ Daylight Saving Time (DST) transitions convert local times to accurate UTC timestamps across hemispheres
  ✓ Custom VTIMEZONE with non-IANA TZID converts local timestamps correctly
  ✓ Floating time events preserve floating representation without Z or TZID
  ✓ All-day events format compliant non-inclusive DTEND and preserve all-day semantics
  ✓ generateVTimeZone emits compliant RFC 5545 VTIMEZONE block for various zones
  ✓ Full round-trip export and import with timezone, DST, and detached exceptions
CALENDAR ICS TESTS: 36 passed, 0 failed

Running Calendar Invitation Repository Integration Tests...
Running Calendar Invitation Repository Integration Tests...
  ✓ 1. Setup: Create stored event at sequence 3 with trusted organizer
  ✓ 2. Stale REQUEST (seq 2 < stored 3): rejected, stored event sequence remains 3
  ✓ 3. Newer REQUEST (seq 4 > stored 3): accepted, stored event sequence updated to 4
  ✓ 4. Duplicate delivery of seq 4: idempotent detection, no DB change, no re-sent reply
  ✓ 5. Stale CANCEL (seq 2 < stored 4): rejected, event status remains active
  ✓ 6. Valid CANCEL (seq 5 > stored 4): accepted, persisted status updated to free/cancelled
  ✓ 7. Organizer hijack attempt (different organizer): rejected, stored organizer untouched
  ✓ 8. Locked mailbox fail-closed: returns actionable unlock message, DB untouched, no outbound email
Running Calendar Persistence Security Tests...
Running Calendar Persistence Security Tests (P0 Remediation)...
  ✓ 1. Missing mailbox key prevents event creation
  ✓ 2. Missing mailbox key prevents event updates
  ✓ 3. Locked mailbox causes zero persistence requests
[CalendarPersistenceController] Event encryption failed: Error: WASM AES-GCM encryption failed: Simulated WASM out of memory
    at encryptCalendarEventPayload (F:\Codex\byos-email\apps\webmail\src\calendar_crypto.ts:199:11)
    at CalendarPersistenceController.handleSaveEvent (F:\Codex\byos-email\apps\webmail\src\calendar_persistence_security.test.ts:96:26)
    at <anonymous> (F:\Codex\byos-email\apps\webmail\src\calendar_persistence_security.test.ts:300:24)
    at test (F:\Codex\byos-email\apps\webmail\src\calendar_persistence_security.test.ts:156:13)
    at runCalendarPersistenceSecurityTests (F:\Codex\byos-email\apps\webmail\src\calendar_persistence_security.test.ts:287:9)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:289:34)
  ✓ 4. WASM encryption failure causes zero persistence requests
  ✓ 5. No Base64/plaintext fallback exists in the persistence path
  ✓ 6. Successful encryption persists the encrypted envelope
[calendar_crypto] Decryption failed: decryption failed
[calendar_crypto] Decryption failed: decryption failed
  ✓ 7. Wrong mailbox key cannot decrypt another mailbox's event
[calendar_crypto] Decryption failed: decryption failed
  ✓ 8. Tampered ciphertext fails closed
  ✓ 9. Existing valid encrypted events remain readable
[calendar_crypto] Refusing to interpret unencrypted or legacy JSON payload as decrypted ciphertext
  ✓ 10. Existing legacy records are identified without being silently modified
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed

CALENDAR REPO INTEGRATION TESTS: 5 passed, 0 failed

Running Historical Key Reactivation Tests...
Running Historical Key Reactivation & Preflight Tests...
  ✓ 1. Correct historical password and valid new password succeeds
  ✓ 2. Incorrect historical password fails closed before generating envelope
  ✓ 3. New password and confirmation mismatch is rejected before crypto operations
  ✓ 4. Invalid password-policy input is rejected
  ✓ 5. Candidate wrapper successfully unwraps to the original mailbox secret
  ✓ 6. Candidate wrapper unwrap mismatch is caught by constantTimeEqual
  ✓ 7. Malformed candidate envelope fails unwrap closed
  ✓ 8. Simulated reactivation controller does not dispatch API when preflight fails
  ✓ 9. Preflight preserves root_wrapped from historical JSON envelope
  ✓ 10. verifyReadBackCandidateEnvelope validates server-returned candidate with proposed password
  ✓ 11. verifyReadBackCandidateEnvelope rejects tampered or mismatched candidate secret
  ✓ 12. verifyReadBackCandidateEnvelope fails closed on empty or malformed read-back
  ✓ 13. executeStagedHistoricalKeyReactivation coordinates prepare, read-back, verify, and finalize
  ✓ 14. Read-back candidate difference triggers rollback and aborts before finalization
  ✓ 15. Preflight failure prevents prepare, read-back, finalize, or rollback from running
HISTORICAL KEY REACTIVATION TESTS: 15 passed, 0 failed

Running Calendar Recovery Tests...
Running Calendar Recovery Tests...
  ✓ validateMailboxKeyProvenance: authentic key and matching pk succeeds
  ✓ validateMailboxKeyProvenance: mailbox id mismatch rejects provenance
  ✓ validateMailboxKeyProvenance: wrong public key fails mathematical pairing
  ✓ validateMailboxKeyProvenance: invalid key length fails closed
  ✓ validateMailboxKeyProvenance: missing key or pk fails closed
  ✓ findLegacyCalendarEvents: separates legacy plaintext JSON from encrypted envelopes
  ✓ executeLegacyCalendarEventRecovery: successful 4-phase recoverable workflow
  ✓ executeLegacyCalendarEventRecovery: read-back verification mismatch triggers rollback
[calendar_crypto] Decryption failed: unsupported version
  ✓ executeLegacyCalendarEventRecovery: read-back decryption failure triggers rollback
  ✓ executeLegacyCalendarEventRecovery: stage 412 Precondition Failed aborts cleanly without rollback
CALENDAR RECOVERY TESTS: 10 passed, 0 failed

Running Calendar Recurrence Exceptions Tests...
Running Calendar Recurrence Exceptions & Interoperability Tests...
  ✓ 1. Modifying a single occurrence creates encrypted detached exception without altering parent series
  ✓ 2. Cancelling an occurrence creates a cancellation exception and suppresses it from recurrence expansion
  ✓ 3. Deleting the parent series cascades to delete all detached exceptions
  ✓ 4. Locked mailbox fails closed and rejects exception creation before persistence
  ✓ 5. RFC 5545 iCalendar export and import preserves series and detached exception linkage
CALENDAR RECURRENCE EXCEPTIONS TESTS: 5 passed, 0 failed

Running Calendar External Invitations Tests...
Running Calendar External Invitations & Fallback Delivery Tests...
  ✓ 1. sendMimeWithFallback: routes to Path A (E2E) for internal recipient
  ✓ 2. sendMimeWithFallback: falls back to Path B for external recipient
  ✓ 3. sendMimeWithFallback: fails closed on local crypto error
  ✓ 4. sendMimeWithFallback: reports failure on Path B server rejection
  ✓ 5. Outbound invitation formatting: compliant RFC 5545 REQUEST
  ✓ 6. Event update sequence increment: SEQUENCE monotonically increments
  ✓ 7. Cancellation dispatch: METHOD:CANCEL with incremented sequence
  ✓ 8. Occurrence cancellation dispatch: includes RECURRENCE-ID
  ✓ 9. Outbound RSVP reply formatting: compliant RFC 5546 REPLY
  ✓ 10. External RSVP dispatch pipeline: routes via Path B to external organizer
CALENDAR EXTERNAL INVITATIONS TESTS: 10 passed, 0 failed

Running Calendar Sharing Tests...
  ✓ sealCalendarKeyForGrantee seals with HPKE and unseal recovers exact key
  ✓ sealing rejects invalid calendar key length
  ✓ sealing rejects invalid recipient public key
  ✓ unsealing with wrong recipient private key fails closed
  ✓ unsealing tampered envelope fails closed
  ✓ Bob can decrypt Alice's shared calendar events using unsealed calendar key and Alice AAD
  ✓ Read-only calendar permissions enforce creation and modification guards
  ✓ sealing calendar key with KeyDirectoryRecord xwing_public_key extracts X25519 pk and unseals
  ✓ calendar sharing fails closed when mailbox key is missing or malformed
  ✓ calendar sharing key resolution supports 2432-char hex and 32-byte base64 keys
CALENDAR SHARING TESTS: 10 passed, 0 failed

Running Calendar Settings Tests...
  ✓ 1. Registry specifies exactly the 10 sections from Section 4.1
  ✓ 2. Every setting in registry belongs to a valid section and has valid scope
  ✓ 3. Search/filtering finds settings by label, description, and keywords
  ✓ 4. loadCalendarSettings returns default values when storage is empty
  ✓ 5. saveCalendarSettings and loadCalendarSettings persist and restore preferences
  ✓ 6. Three-level configuration scope separation: global vs calendar vs event
  ✓ 7. World clock cities configuration can be modified and restored
CALENDAR SETTINGS TESTS: 7 passed, 0 failed

Running Calendar Management Tests...
Starting Calendar Management (Category 02) Tests...
  ✓ 1. Calendar templates definition and pre-fills
  ✓ 2. Calendar overrides save and load lifecycle
  ✓ 3. Multi-level reminder resolution precedence (Global < Calendar < Event)
  ✓ 4. Owned vs shared calendar separation and identification
  ✓ 5. Safe calendar deletion constraints and permissions
  ✓ 6. Unsubscribe action targets share grant without destroying source calendar
CALENDAR MANAGEMENT TESTS: 6 passed, 0 failed

Running Calendar Holiday & Religious Tests...
Starting Holiday and Religious Calendars (Category 03) Tests...
  ✓ 1. Holiday feeds catalogue completeness & categorisation
  ✓ 2. Bangladesh national holidays and regional observances focus
  ✓ 3. Religious honesty: provisional moon-sighting vs fixed vs calculated dates
  ✓ 4. Subscription store: subscribe, deduplication, color, visibility, hide/restore
  ✓ 5. Projection to UserCalendar & DecryptedEventRecord generation
CALENDAR HOLIDAY & RELIGIOUS TESTS: 5 passed, 0 failed

Running Calendar Year View Tests...
Starting Calendar Year View Tests...
  ✓ 1. Year View generates exactly 12 months
  ✓ 2. Month day counts: handles leap years (2024 vs 2026)
  ✓ 3. Leading blanks calculation under Sunday, Monday, Saturday week start
  ✓ 4. Year navigation advances or decrements by 1 full year
  ✓ 5. Year view period title displays 4-digit year
  ✓ 6. Event distribution and holiday detection in Year View

CALENDAR YEAR VIEW TESTS: 6 passed, 0 failed

Running Calendar Categories 01, 02, and 03 Comprehensive Tests...
Starting Calendar Categories 01, 02, and 03 Integration Tests...
  ✓ Cat 01.1: Settings Registry defines exactly the 10 sections from Section 4.1
  ✓ Cat 01.2: Settings search queries match across labels, descriptions, and keywords
  ✓ Cat 01.3: User preferences persist and restore per mailbox, with default fallbacks
  ✓ Cat 01.4: Per-calendar overrides save and load independently
  ✓ Cat 02.1: URL normalization and validation handles http, https, and webcal
  ✓ Cat 02.2: External URL subscription lifecycle: subscribe, deduplicate, project to UserCalendar
  ✓ Cat 03.1: Complete international country coverage (200+ countries from date-holidays)
  ✓ Cat 03.2: Dynamic generation of holidays for arbitrary international country (e.g. Japan)
  ✓ Cat 03.3: Bangladesh national holidays gazetted accuracy & UNESCO history preservation
  ✓ Cat 03.4: Religious honesty: Islamic moon-sighting caveats and multi-tradition coverage
  ✓ Cat 03.5: Multi-year dynamic generation across year ranges (2025-2027)
  ✓ Cat 03.6: Subscription store: subscribe, color, observances toggle, and safe unsubscription

CALENDAR CATEGORIES 01, 02, 03 TESTS: 12 passed, 0 failed

CALENDAR CATEGORIES 01, 02, 03 TESTS: 12 passed, 0 failed

Running Calendar Category 04 (Alternate & Special Calendars) Tests...
  ✓ Cat 04.1: Alternate Calendar System - Bengali (Bangabda) calculations
  ✓ Cat 04.2: Alternate Calendar Systems - Multi-system format validation
  ✓ Cat 04.3: Canonical Gregorian Event Instant Invariance
  ✓ Cat 04.4: Settings Registry & Store Configuration
  ✓ Cat 04.5: Special-Interest & Sports Feeds Catalogue Completeness
  ✓ Cat 04.6: Sports & Moon Feed Subscription Lifecycle
CALENDAR CATEGORY 04 TESTS: 6 passed, 0 failed

Running Calendar Category 05 (Language, Region & Time Management) Tests...
Starting Calendar Category 05 (Language, Region & Time Management) Tests...
  ✓ Cat 05.1: Regional Date & Time Formatting (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, 12h/24h)
  ✓ Cat 05.2: Week Number Calculation across ISO 8601, First-Day & Full-Week Conventions
  ✓ Cat 05.3: Bidirectional UTC-to-Zoned Time Conversions across Global IANA Zones
  ✓ Cat 05.4: Daylight Saving Time (DST) Transitions & Canonical Instant Invariance
  ✓ Cat 05.5: World Clock Engine, Live City Conversions & Relative Day Indicators
  ✓ Cat 05.6: Settings Registry, Store Integrity & Location Detection Safeguards
  ✓ Cat 05.7: RFC 5545 iCalendar UTC Serialization & Instant Preservation

CALENDAR CATEGORY 05 TESTS: 7 passed, 0 failed

CALENDAR CATEGORY 05 TESTS: 7 passed, 0 failed

Running Calendar Category 06 (Event Creation & Management) Tests...
Starting Calendar Category 06 (Event Creation & Management) Tests...
  ✓ Cat 06.1: Event Plaintext Schema, Visibility, Permissions & Attachments
  ✓ Cat 06.2: End-to-End AES-GCM Authenticated Encryption & Decryption Roundtrip
  ✓ Cat 06.3: Locked Mailbox Fail-Closed Verification (Zero Plaintext Leakage)
  ✓ Cat 06.4: Event Duplication & Copy Identity Mechanics
  ✓ Cat 06.5: Read-Only Calendar Permission Enforcement Guards
  ✓ Cat 06.6: Event-Level Settings Override Precedence (Color, Reminders, Visibility)
  ✓ Cat 06.7: RFC 5545 iCalendar Serialization (CLASS, VALARM & ATTACH Components)

CALENDAR CATEGORY 06 TESTS: 7 passed, 0 failed

CALENDAR CATEGORY 06 TESTS: 7 passed, 0 failed

Running Calendar Category 07 (Recurrence & Advanced Scheduling Rules) Tests...
Starting Calendar Category 07 (Recurrence & Advanced Scheduling Rules) Tests...
  ✓ Cat 07.1: Recurrence Rule Parsing & Serialization Roundtrip
  ✓ Cat 07.2: Custom Interval & Multi-Day Weekly Rules (Bi-Weekly Tue/Thu)
  ✓ Cat 07.3: COUNT and UNTIL Bounded Termination Safeguards
  ✓ Cat 07.4: Date Boundary Correctness (Month-End & Leap Years)
  ✓ Cat 07.5: Detached Modified Occurrences (Preserves Stable Recurrence-ID)
  ✓ Cat 07.6: Persistent Cancelled Occurrences & EXDATE Reconciliation
  ✓ Cat 07.7: Series Edits & Orphaned Exceptions Cascading Isolation
[calendar_crypto] Decryption failed: decryption failed
  ✓ Cat 07.8: Cryptographic Boundary & Zero Plaintext Leakage
  ✓ Cat 07.9: RFC 5545 iCalendar Serialization & Reconciliation

CALENDAR CATEGORY 07 TESTS: 9 passed, 0 failed

CALENDAR CATEGORY 07 TESTS: 9 passed, 0 failed

Running Calendar Category 08 (Notifications & Reminders) Tests...
CALENDAR CATEGORY 08 TESTS: 8 passed, 0 failed

Running Calendar Category 10 (Working Hours, Availability & Productivity Status) Tests...
CALENDAR CATEGORY 10 TESTS: 8 passed, 0 failed

Running Calendar Category 11 (Tasks & Personal Productivity) Tests...
CALENDAR CATEGORY 11 TESTS: 9 passed, 0 failed

Running Calendar Category 12 (Appointment Scheduling & Booking Pages) Tests...
CALENDAR CATEGORY 12 TESTS: 9 passed, 0 failed

Running Calendar Category 13 (Email and External Integrations) Tests...
Running Calendar Category 13 (Email and External Integrations) Tests...
  ✓ Cat 13.1: Flight reservation extraction
  ✓ Cat 13.2: Hotel booking extraction
  ✓ Cat 13.3: Restaurant dining reservation extraction
  ✓ Cat 13.4: Ticket and Webinar event extraction
  ✓ Cat 13.5: Cancellation email detection and status flagging
  ✓ Cat 13.6: Client-side privacy boundary and individual category disable toggles
  ✓ Cat 13.7: Suggestion store, deduplication, and email-to-calendar linking
  ✓ Cat 13.8: Video-conferencing URL generation across providers
  ✓ Cat 13.9: Contact birthday extraction and annual calendar event projection
CALENDAR CATEGORY 13 TESTS: 9 passed, 0 failed

Running Calendar Category 14 (Import, Export and Synchronization) Tests...
Running Calendar Category 14 (Import, Export and Synchronization) Tests...
  ✓ Cat 14.1: ICS file validation, size limits (512KB rejection), and event count limits
  ✓ Cat 14.2: Full calendar export to RFC 5545 format (VCALENDAR, VTIMEZONE, VEVENT, CLASS, VALARM)
  ✓ Cat 14.3: ICS import parsing with UID preservation, timezone normalization, and payload encryption
  ✓ Cat 14.4: Duplicate detection and conflict handling (skip_duplicates vs update_duplicates)
  ✓ Cat 14.5: Recurrence rule and exception preservation on import/export round-trip
  ✓ Cat 14.6: External URL feed subscription lifecycle (subscribe, cache, refresh, pause, resume, unsubscribe)
[urlCalendarStore] Proxy fetch failed, falling back to direct fetch: TypeError: Failed to fetch
    at globalThis.fetch (F:\Codex\byos-email\apps\webmail\src\calendar_category_14.test.ts:496:21)
    at fetchAndParseUrlFeed (F:\Codex\byos-email\apps\webmail\src\components\calendar\url\urlCalendarStore.ts:125:29)
    at <anonymous> (F:\Codex\byos-email\apps\webmail\src\calendar_category_14.test.ts:502:15)
    at check (F:\Codex\byos-email\apps\webmail\src\calendar_category_14.test.ts:68:13)
    at runCalendarCategory14Tests (F:\Codex\byos-email\apps\webmail\src\calendar_category_14.test.ts:460:9)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:414:20)
[urlCalendarStore] Proxy fetch failed, falling back to direct fetch: TypeError: Failed to fetch
    at globalThis.fetch (F:\Codex\byos-email\apps\webmail\src\calendar_category_14.test.ts:544:15)
    at fetchAndParseUrlFeed (F:\Codex\byos-email\apps\webmail\src\components\calendar\url\urlCalendarStore.ts:125:29)
    at refreshUrlSubscription (F:\Codex\byos-email\apps\webmail\src\components\calendar\url\urlCalendarStore.ts:293:23)
    at refreshDueUrlSubscriptions (F:\Codex\byos-email\apps\webmail\src\components\calendar\url\urlCalendarStore.ts:392:24)
    at <anonymous> (F:\Codex\byos-email\apps\webmail\src\calendar_category_14.test.ts:547:36)
    at async check (F:\Codex\byos-email\apps\webmail\src\calendar_category_14.test.ts:68:7)
    at async runCalendarCategory14Tests (F:\Codex\byos-email\apps\webmail\src\calendar_category_14.test.ts:460:3)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:414:20)
[urlCalendarStore] Refresh failed for https://broken-external.local/calendar.ics: Error: Unable to fetch calendar feed due to cross-origin restriction (CORS) or network error: Failed to fetch. To import external feeds that block direct browser requests, download the .ics file and use Calendar Settings -> Import ICS.
    at fetchAndParseUrlFeed (F:\Codex\byos-email\apps\webmail\src\components\calendar\url\urlCalendarStore.ts:158:15)
    at async refreshUrlSubscription (F:\Codex\byos-email\apps\webmail\src\components\calendar\url\urlCalendarStore.ts:293:17)
    at async refreshDueUrlSubscriptions (F:\Codex\byos-email\apps\webmail\src\components\calendar\url\urlCalendarStore.ts:392:18)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\calendar_category_14.test.ts:547:30)
    at async check (F:\Codex\byos-email\apps\webmail\src\calendar_category_14.test.ts:68:7)
    at async runCalendarCategory14Tests (F:\Codex\byos-email\apps\webmail\src\calendar_category_14.test.ts:460:3)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:414:20)
  ✓ Cat 14.7: Subscribed feed error handling, invalid URL rejection, and safe fallback
  ✓ Cat 14.8: CalDAV protocol metadata, URL generation, and principal resolution
  ✓ Cat 14.9: Client-side privacy boundary (zero plaintext leakage on export and import)

CALENDAR CATEGORY 14 TESTS: 9 passed, 0 failed

CALENDAR CATEGORY 14 TESTS: 9 passed, 0 failed

Running Calendar Category 15 (Accessibility, Interface and Offline Experience) Tests...
Running Calendar Category 15 (Accessibility, Interface & Offline Experience) Tests...
  ✓ Cat 15.1: View density and display controls (compact vs comfortable, week numbers, weekends)
  ✓ Cat 15.2: Declined event visibility and strikethrough styling logic
  ✓ Cat 15.3: Offline event action queueing and safety invariant ('queued_locally')
  ✓ Cat 15.4: Offline decrypted event caching and retrieval
  ✓ Cat 15.5: Offline sync reconnection and conflict detection without silent overwrite
  ✓ Cat 15.6: Deleted-event trash lifecycle (30-day retention countdown, restore, permanent delete, empty)
  ✓ Cat 15.7: Transient undo action coordination alongside persistent trash
  ✓ Cat 15.8: Keyboard navigation and global shortcut map
  ✓ Cat 15.9: Screen-reader announcements (aria-live='polite') and accessibility attributes

CALENDAR CATEGORY 15 TESTS: 9 passed, 0 failed

CALENDAR CATEGORY 15 TESTS: 9 passed, 0 failed

Running Calendar Interval Scheduling & Layout Tests...
  ✓ 1. Empty input handling
  ✓ 2. Single event spans 100% width
  ✓ 3. Disjoint non-overlapping events independently span 100% width
  ✓ 4. Two overlapping events allocate 50/50 parallel non-colliding columns
  ✓ 5. Three concurrent events allocate 3 parallel columns with 0% collision
  ✓ 6. Greedy interval scheduling correctly packs sequential sub-intervals
  ✓ 7. Day View cleanly allocates 5 parallel non-overlapping lanes
  ✓ 8. Week View high-concurrency clusters cascade with >= 60% readable card width
  ✓ 9. getOpaqueEventBg computes 100% solid, fully-opaque surfaces
CALENDAR INTERVAL & LAYOUT TESTS: All 9 passed, 0 failed

Running Google Keep Notes Feature Tests...
  ✓ 1. Initial load provides welcome notes with checklists, labels, and reminders
  ✓ 2. Google Keep labels management (add, rename, delete all without restore bug) works reliably
  ✓ 3. createNote supports checklists, color styling, labels, and reminders
  ✓ 4. Archive and Unarchive note lifecycle functions correctly
  ✓ 5. Bin lifecycle (move to bin, restore, and empty bin) matches Google Keep
  ✓ 6. Duplicate note functionality works as expected
  ✓ 7. Verified all 8 approved Google Keep pastel color definitions
  ✓ 8. Version history snapshot and restoration round-trip functions correctly
  ✓ 9. Composer history undo/redo bounded indexing maintains valid array bounds
  ✓ 10. Zero-Knowledge AES-GCM encryption and decryption round-trip succeeds
  ✓ 11. Zero-Knowledge notes fail closed without key or with invalid key
  ✓ 12. Seamless backward compatibility for existing unencrypted legacy notes
  ✓ 13. Interoperable AES-GCM Web Crypto (crypto.subtle) and byos_crypto_core encryption
  ✓ 14. Selection-aware Markdown formatting (bold, italic, underline, list) and cursor positioning
  ✓ 15. IndexedDB offloading for drawings and photos prevents localStorage quota exhaustion
  ✓ 16. Edit note modal reminder adjustments and checklist mode toggling function correctly
  ✓ 17. Version history restoration retains IndexedDB media after drawing removal
  ✓ 18. Cascading media garbage collection prunes unreferenced items and preserves shared media
Cannot update locked encrypted note without decryption key
Cannot duplicate note: mailbox encryption key is unavailable
  ✓ 19. Locked encrypted notes fail closed on update and duplication attempts
  ✓ 20. Version history snapshot accurately preserves prior revisions on note edits
  ✓ 21. Media cache LRU bounds eviction caps memory usage at 150 items
Cannot create note: mailbox encryption key is unavailable
  ✓ 22. Missing mailbox key fails closed (cannot create or persist note in plaintext)
Cannot persist notes: mailbox encryption key is unavailable. Failing closed to prevent plaintext leakage.
  ✓ 23. Plaintext persistence fallback is completely eliminated
Cannot persist notes: mailbox encryption key is unavailable. Failing closed to prevent plaintext leakage.
  ✓ 24. Save failure fails closed without leaking unencrypted data to storage
  ✓ 25. Context-specific v2 AAD binds note ID and mailbox ID (byos-notes-v2:${mailboxId}:${noteId})
  ✓ 26. Cross-note ciphertext substitution within same mailbox fails closed via v2 AAD binding
  ✓ 27. Cross-mailbox ciphertext substitution fails closed via mailboxId AAD binding
  ✓ 28. Tampered ciphertext envelope fails closed and returns null
  ✓ 29. Backward compatibility: legacy v1 AAD encrypted note decrypts seamlessly
  ✓ 30. Legacy v1 AAD note upgrades to v2 context-bound AAD on next edit/save
  ✓ 31. Legacy plaintext note is preserved when key is unavailable (no premature migration)
  ✓ 32. Legacy plaintext note migrates to v2 AES-GCM when key is available with verified round-trip
  ✓ 33. Legacy plaintext note migration failure leaves original plaintext intact (safe rollback)
  ✓ 34. Account switching isolation: cross-account key decrypts fail closed
  ✓ 35. Session isolation & logout cleanup wipes notes in-memory key and media cache
  ✓ 36. Favorites lifecycle: toggle on, toggle off, persistence, and account isolation
GOOGLE NOTE FEATURE TESTS: All 36 passed, 0 failed

Running Webmail Notes Customer Storage Sync & Conflict Resolution Tests...
  ✓ 1. encryptRemoteNote & decryptRemoteNote authenticated roundtrip with Section 12 framing
[notesSync] Failed to decrypt remote note note-target-1: DOMException [OperationError]: The operation failed for an operation-specific reason
    at AESCipherJob.onDone (node:internal/crypto/util:437:19) {
  [cause]: [Error: Cipher job failed]
}
[notesSync] Failed to decrypt remote note note-other-2: DOMException [OperationError]: The operation failed for an operation-specific reason
    at AESCipherJob.onDone (node:internal/crypto/util:437:19) {
  [cause]: [Error: Cipher job failed]
}
[notesSync] Failed to decrypt remote note note-target-1: DOMException [OperationError]: The operation failed for an operation-specific reason
    at AESCipherJob.onDone (node:internal/crypto/util:437:19) {
  [cause]: [Error: Cipher job failed]
}
[notesSync] Failed to decrypt remote note note-target-1: DOMException [OperationError]: The operation failed for an operation-specific reason
    at AESCipherJob.onDone (node:internal/crypto/util:437:19) {
  [cause]: [Error: Cipher job failed]
}
  ✓ 2. decryptRemoteNote fails closed on wrong key, tampered ciphertext, or transposed note ID
  ✓ 3. Multi-Device Sync: Device A creates note, uploads to customer storage; Device B discovers and decrypts
  ✓ 4. Conflict Resolution: Simultaneous edits on Device A & B create conflict copy with distinct AAD
  ✓ 5. Tombstone Deletions: Note deleted on Device A uploads tombstone; Device B deletes without resurrection
  ✓ 6. Encrypted Media Sync: Drawing encrypted in IDB uploaded to storage and pulled to Device B
  ✓ 7. Offline Queue: Operations queued while offline and flushed upon connection restore
  ✓ 8. Three-Device Conflict: A syncs, then B syncs, then offline C reconnects and syncs
  ✓ 9. Three-Device Conflict: B syncs before A, then C reconnects
  ✓ 10. Offline Editing Lifecycle: Create, edit, delete offline and repeated sync idempotency
  ✓ 11. Stale Device Tombstone Retention: Offline device cannot resurrect deleted notes
WEBMAIL NOTES SYNC TESTS: 11 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
  ✓ Mailbox unlock succeeds when login requires 2FA by resolving wrapped_sk_user from mailbox detail
  ✓ Mailbox unlock fails closed on invalid password
  ✓ 2FA status with no enrolled factors evaluates to two_factor_enabled = false
  ✓ Disabling TOTP preserves inactive state after simulated reload
  ✓ Deleting passkey transitions 2FA to inactive and stays inactive on reload
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

Running Track 2 & Zero-Knowledge Security Tests...

--- Part A.1: In-Memory Key Custody & Zeroization ---
  ✓ sessionStorage has NO private key hex strings after setAccountKeys
  ✓ zeroizeKeys fills in-memory buffers with 0 and sweeps sensitive keys from storage
  ✓ unsealAccountKeys purges sessionStorage legacy keys and loads in-memory
  ✓ sanitizeConnectedAccounts removes private keys from accounts before session storage
  ✓ full login flow verifies sessionStorage contains NO private key hex strings after login

--- Part A.2: Encrypted Contacts Wireup ---
  ✓ encryptContactEnvelope creates valid ciphertext and decryptContactEnvelope unpacks all fields
  ✓ contact creation dispatches ciphertext envelopes with NO plaintext fields
  ✓ contact creation fails closed without active mailbox key

--- Part A.3: Envelope Draft Subjects & Recipients ---
  ✓ draft saving packages subject, recipient, and body into ciphertext envelope and zeroes API fields

--- Part B.1: Debounced Draft Auto-Save ---
  ✓ debounced autosave dirty-state tracking and cancellation

--- Part B.2: Live Snooze Expiration Loop ---
  ✓ isMessageSnoozed correctly checks future vs expired timestamps
  ✓ checkSnoozeExpirations identifies messages expiring in the time window
  ✓ live snooze expiration loop wakes snoozed messages into inbox with read: false and clears snoozedUntil

--- Part B.3: RFC 5322 .eml Export ---
  ✓ buildEmlContent formats RFC 5322 MIME headers and multipart mixed attachments
  ✓ uint8ArrayToBase64 safely encodes large buffers without failure

--- Part B.4: Dynamic Sender Key Epoch Resolution ---
[notesSync] Sync failed: TypeError: Failed to parse URL from /v1/mailboxes/c1000000-0000-0000-0000-000000000001/storage/list?prefix=notes%2F
    at node:internal/deps/undici/undici:15422:13
    at async listMailboxStorageObjects (F:\Codex\byos-email\apps\webmail\src\api.ts:2763:15)
    at async syncNotesWithRemote (F:\Codex\byos-email\apps\webmail\src\components\notes\notesSync.ts:350:26)
    at async Timeout._onTimeout (F:\Codex\byos-email\apps\webmail\src\components\notes\notesSync.ts:672:9) {
  [cause]: TypeError: Invalid URL
      at new URL (node:internal/url:826:25)
      at new Request (node:internal/deps/undici/undici:10174:25)
      at fetch (node:internal/deps/undici/undici:10944:25)
      at fetch (node:internal/deps/undici/undici:15420:10)
      at fetch (node:internal/bootstrap/web/exposed-window-or-worker:83:12)
      at listMailboxStorageObjects (F:\Codex\byos-email\apps\webmail\src\api.ts:2763:21)
      at syncNotesWithRemote (F:\Codex\byos-email\apps\webmail\src\components\notes\notesSync.ts:350:32)
      at Timeout._onTimeout (F:\Codex\byos-email\apps\webmail\src\components\notes\notesSync.ts:672:15)
      at listOnTimeout (node:internal/timers:608:17)
      at process.processTimers (node:internal/timers:543:7) {
    code: 'ERR_INVALID_URL',
    input: '/v1/mailboxes/c1000000-0000-0000-0000-000000000001/storage/list?prefix=notes%2F'
  }
}
  ✓ decryptPathAEnvelope resolves dynamic key epoch without failing thread decryption
  ✓ decryptPathAEnvelope does NOT throw and preserves thread plaintext even if sender verification fails
Failed to decrypt signature envelope: decryption failed
  ✓ encryptSignature and decryptSignature roundtrip with authenticated AES-GCM envelope
TRACK 2 & ZERO-KNOWLEDGE SECURITY TESTS: 18 passed, 0 failed


Running Calendar Track 3 Verification Tests...
  ✓ Track 3.1: External Calendar URL normalization converts webcal:// to https://
[urlCalendarStore] Proxy fetch returned HTTP 502, falling back to direct fetch
  ✓ Track 3.2: URL feed fetcher routes through /v1/calendar/feed-proxy and falls back to direct fetch
  ✓ Track 3.3: OfflineActionType supports create_exception, update_exception, delete_exception
  ✓ Track 3.4: syncOfflineQueue replays recurrence exception actions and clears queue
  ✓ Track 3.5: moveEventToTrash encrypts details with AES-GCM and eliminates plaintext leakage in localStorage
  ✓ Track 3.6: Calendar trash supports legacy unencrypted fallback
  ✓ Track 3.7: saveTask encrypts task title and description with AES-GCM when key is available
  ✓ Track 3.8: taskStore supports legacy unencrypted fallback

CALENDAR TRACK 3 TESTS: 8 passed, 0 failed

Running Track 4: Webmail Reliability, Zero-Knowledge Media Encryption & Resilience Tests...
  ✓ Track 4.1: encryptNotesMedia & decryptNotesMedia perform authenticated AES-GCM roundtrip
[notesStore] WASM AES-GCM media decryption failed: decryption failed
[notesStore] WASM AES-GCM media decryption failed: decryption failed
  ✓ Track 4.2: decryptNotesMedia fails closed on wrong key or tampered ciphertext
  ✓ Track 4.3: saveMediaToIDB encrypts dataUrl in IndexedDB and redacts plaintext
  ✓ Track 4.4: getMediaFromIDB supports legacy unencrypted media fallback
  ✓ Track 4.5: offloadMediaIfDataUrl creates idb pointer and encrypts when key is provided
  ✓ Track 4.6: folderCounts correctly aggregates inbox, drafts, sent, trash, and snoozed
  ✓ Track 4.7: Bridge status transitions correctly based on health and credentials

TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed
Running Off-Thread Crypto Web Worker & Bridge Tests...
  ✓ Worker bridge ping heartbeat succeeds over message channel
  ✓ Argon2id passphraseWrapKey & passphraseUnwrapKey roundtrip offloaded correctly
  ✓ autoUnwrapKeys derives mailboxSk, signingSeed, xwingSeed, and searchKey off-thread
  ✓ X-Wing hybrid envelope seal and open roundtrip via worker pipeline
  ✓ Multi-chunk AES-256-GCM attachment prepare and decrypt roundtrip
[Worker Crypto] Decryption failed for attachment_id=a639e568-75a0-4891-94b0-ce4b899b7335 chunk_index=1
  ✓ Tampered attachment chunk is isolated and reports specific chunk index
  ✓ Worker rejects invalid operations and returns structured error
  ✓ Worker bridge enforces operation timeout and cleans pending request
[CryptoWorkerBridge] Worker error encountered: Out of memory simulated crash
  ✓ Worker error event triggers crash cleanup and rejects pending requests
  ✓ Transferable ArrayBuffer detaches buffer on message channel dispatch
  ✓ zeroizeBuffer wipes sensitive in-memory bytes to 0
  ✓ Dispatches multiple concurrent operations across the worker message channel without interference
  ✓ Direct execution fallback mode operates reliably when worker is disabled
Running Subscriptions & Unsubscribe Store Tests...
Running Subscriptions Store & Unsubscribe Tests...
  ✓ 1. TestExtractCleanEmailAndDisplayName
  ✓ 2. TestExtractUnsubscribeLinkFromHeadersAndBody
  ✓ 3. TestUnsubscribeAndResubscribeLifecycle
  ✓ 4. TestDetectSubscriptionsAggregatesMessages
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed

Running Image Privacy Store Tests...
Running Image Privacy Store Tests...
  ✓ 1. TestExtractCleanEmailAddress
  ✓ 2. TestDefaultPolicyIsAsk
  ✓ 3. TestAlwaysAllowLifecycle
  ✓ 4. TestClearSenderPreference
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed

Running KashCal Natural Language Event Parser Tests...
  ✓ parses category keywords correctly
  ✓ parses 'Coffee with Sarah tomorrow 3pm'
  ✓ parses 'Design review Friday 10am 45m'
  ✓ parses time range 'Team standup 2pm-3:30pm'
  ✓ parses explicit date 'Dentist appointment Nov 12 at 2pm'
  ✓ parses all-day event 'Alice Birthday Nov 20 all-day'
KASHCAL PARSER TESTS: 6 passed, 0 failed

Running Translator & Localization Tests...
Running Translator & Localization Tests...
  ✓ detectLanguage identifies supported scripts and stop words
  ✓ getLanguageName maps language codes correctly
  ✓ translateEmail returns identical content when source and target match
  ✓ translateEmail preserves HTML tags, attributes, and structure
  ✓ translateEmail preserves casing in Latin scripts
  ✓ translateEmail translates CJK and Arabic to English without screaming all-caps
  ✓ translateEmail does not replace subwords like 'Othello' or 'shell'
  ✓ translateEmail prioritizes longer multi-word phrases over single words
  ✓ translateEmail roundtrip between English and Spanish
  ✓ translateEmail translates into French, German, and Hindi
  ✓ translateEmail translates full email paragraphs without leaving untranslated English words
  ✓ translateEmail translates corporate email into Chinese and Russian with zero residual English
  ✓ t helper returns correct localized UI strings across all supported locales
  ✓ t helper interpolates dynamic params accurately without affecting proper nouns
  ✓ t helper gracefully falls back to English and key itself for unknown keys
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed

Running Folder & Trash Lifecycle Tests...
Running Folder & Permanent Trash Lifecycle Tests...
  ✓ 1. TestDraftMappingPreservesFolderAndFlags
  ✓ 2. TestDraftsInTrashFilterCorrectly
  ✓ 3. TestMovingDraftToTrashAndRestoreInState
  ✓ 4. TestPermanentDeleteFiltersMessage
  ✓ 5. TestEmptyTrashFiltersAllTrashItems
  ✓ 6. TestReadingPaneDraftDetectionInTrash
  ✓ 7. TestUndoActionStoresPreviousAndTargetFolder
  ✓ 8. TestSentMessageMoveRestrictions
  ✓ 9. TestSnoozeRestrictions
FOLDER & TRASH TESTS: 9 passed, 0 failed

OVERALL: 718 passed, 0 failed
```