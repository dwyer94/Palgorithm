import { SegmentedControl } from './components';
import { useReferenceContext, type ReferenceKind } from './ReferenceContext';
import PalReferenceList from './reference/PalReferenceList';
import PerkReferenceList from './reference/PerkReferenceList';

/** Full-screen home for the Pal/Perk quick reference — the "maximized" destination for the
 * floating bubbles (`ReferenceBubbles`). Shares the same search/filter/sort state via
 * `ReferenceContext`, so maximizing a bubble lands here showing exactly what it showed. */
export default function ReferenceView() {
  const { focusedTab, setFocusedTab } = useReferenceContext();

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[1040px] px-4 pb-[60px] pt-[26px] md:px-[34px]">
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

        {focusedTab === 'pals' ? <PalReferenceList /> : <PerkReferenceList />}
      </div>
    </main>
  );
}
