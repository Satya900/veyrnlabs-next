import type { Stage } from "@/lib/crm/model";

export function StageForm({
  stage,
  disabled,
  save,
}: {
  stage?: Stage;
  disabled: boolean;
  save: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <form
      className="crm-stage-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        if (
          (await save({
            action: "saveStage",
            id: stage?.id,
            name: f.get("name"),
            position: Number(f.get("position")),
          })) &&
          !stage
        )
          form.reset();
      }}
    >
      <input
        aria-label={stage ? `Stage name: ${stage.name}` : "New stage name"}
        name="name"
        required
        maxLength={60}
        defaultValue={stage?.name}
        placeholder="New stage name"
        disabled={disabled}
      />
      <input
        aria-label="Stage position"
        name="position"
        type="number"
        min={0}
        max={1000}
        required
        defaultValue={stage?.position ?? 5}
        disabled={disabled}
      />
      <button disabled={disabled}>{stage ? "Save" : "Add"}</button>
    </form>
  );
}
