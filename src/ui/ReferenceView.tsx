import { SegmentedControl } from './components';
import { useReferenceContext, type ReferenceKind } from './ReferenceContext';
import PalReferenceList from './reference/PalReferenceList';
import PerkReferenceList from './reference/PerkReferenceList';

/** Full-screen home for the Pal/Perk quick reference — the "maximized" destination for the
 * floating bubbles (`ReferenceBubbles`). Shares the same search/filter/sort state via
 * `ReferenceContext`, so maximizing a bubble lands here showing exactly what it showed.
 *
 * At `md:` and up, this title/tab header is pinned (`md:flex-none`) and only the results panel
 * below it scrolls (`md:min-h-0`, bounded height from this `md:flex md:h-full` column) — that
 * bounded panel is what lets `PalReferenceList`/`PerkReferenceList` virtualize their results
 * below `md:` instead of mounting all ~291 rows (PERFORMANCE_REMEDIATION_PLAN.md Phase 4).
 * Below `md:` this stays exactly the plain stacked/whole-page-scroll layout it always was. */
export default function ReferenceView() {
  const { focusedTab, setFocusedTab } = useReferenceContext();

  return (
    <main className="flex-1 overflow-y-auto bg-canvas md:flex md:h-full md:flex-col md:overflow-hidden">
      <div className="mx-auto w-full max-w-[1040px] px-4 pt-[26px] md:flex-none md:px-[34px]">
        <div className="mb-0.5 font-sans text-[22px] font-bold tracking-[-.4px]">Reference</div>
        <div className="mb-5 font-sans text-[13px] text-muted">
          Search, filter, and sort every Pal and Perk in the dataset.
        </div>

        <div className="mb-4">
          <SegmentedControl<ReferenceKind>
            options={[
              { value: 'pals', label: 'Pals' },
              { value: 'perks', label: 'Perks' },
            ]}
            value={focusedTab}
            onChange={setFocusedTab}
          />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1040px] px-4 pb-[60px] md:min-h-0 md:flex-1 md:px-[34px]">
        {focusedTab === 'pals' ? <PalReferenceList /> : <PerkReferenceList />}
      </div>
    </main>
  );
}
