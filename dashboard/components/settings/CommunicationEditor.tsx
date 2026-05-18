"use client";

// communication.yaml editor for the Settings page.
//
// A react-hook-form (`useForm` + `zodResolver`) over the single editable
// profile's fields. Two independent server actions: "Activate profile" PUTs
// `/api/settings/profile` (which profile `/profile <name>` resolves to), and
// "Save" PATCHes `/api/settings/communication` with the serialized YAML — the
// server re-parses it and 400s on a malformed document, surfaced as a toast.
//
// `GET /api/settings` exposes profile NAMES only, not field values, so the
// field form starts from defaults. When the file holds more than one profile
// the field form is replaced with a CLI-edit notice (editing one profile blind
// would silently drop the others) — the activate-profile control is kept.

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Panel } from "@/components/layout/Panel";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { BoundApi } from "@/lib/project-context";
import type { SettingsResponse } from "@/lib/api";
import {
  communicationFormSchema,
  serializeCommunicationYaml,
  EXPERTISE_VALUES,
  LANGUAGE_VALUES,
  OUTPUT_VALUES,
  TONE_VALUES,
  VERBOSITY_VALUES,
  type CommunicationForm,
} from "@/components/settings/communicationYaml";
import { CommunicationYamlPreview } from "@/components/settings/CommunicationYamlPreview";

interface CommunicationEditorProps {
  /** The settings payload — profile names, active/default profile. */
  settings: SettingsResponse;
  /** Project-bound REST wrappers for the mutate calls. */
  api: BoundApi;
}

/** One enum-select field descriptor for the generated field controls. */
interface EnumFieldSpec {
  name: keyof CommunicationForm;
  label: string;
  values: readonly string[];
}

/** One boolean-switch field descriptor for the generated field controls. */
interface BooleanFieldSpec {
  name: keyof CommunicationForm;
  label: string;
}

const ENUM_FIELDS: readonly EnumFieldSpec[] = [
  { name: "language", label: "Language", values: LANGUAGE_VALUES },
  { name: "tone", label: "Tone", values: TONE_VALUES },
  { name: "verbosity", label: "Verbosity", values: VERBOSITY_VALUES },
  { name: "expertise", label: "Expertise", values: EXPERTISE_VALUES },
  { name: "output", label: "Output", values: OUTPUT_VALUES },
  { name: "explanations", label: "Explanations", values: OUTPUT_VALUES },
];

const BOOLEAN_FIELDS: readonly BooleanFieldSpec[] = [
  { name: "ask_before_acting", label: "Ask before acting" },
  { name: "emojis", label: "Emojis" },
];

/** communication.yaml editor — field form, profile activation, YAML preview. */
export function CommunicationEditor({ settings, api }: CommunicationEditorProps) {
  const editName = settings.defaultProfile ?? settings.availableProfiles[0] ?? "default";
  const isMultiProfile = settings.availableProfiles.length > 1;

  const form = useForm<CommunicationForm>({
    resolver: zodResolver(communicationFormSchema),
    defaultValues: { language: "ru" },
  });
  const values = form.watch();

  const save = form.handleSubmit(async (profile: CommunicationForm) => {
    const yaml = serializeCommunicationYaml(editName, { [editName]: profile });
    try {
      await api.patchCommunication(yaml);
      toast.success("communication.yaml saved");
    } catch (reason: unknown) {
      toast.error(`Failed to save: ${describeError(reason)}`);
    }
  });

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Communication">
        <ActivateProfileRow settings={settings} api={api} />
        {isMultiProfile ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Multi-profile communication.yaml — edit via CLI.
          </p>
        ) : (
          <Form {...form}>
            <form className="mt-3 flex flex-col gap-4" onSubmit={save}>
              <div className="grid grid-cols-2 gap-3">
                {ENUM_FIELDS.map((spec) => (
                  <EnumSelectField key={spec.name} spec={spec} control={form.control} />
                ))}
                {BOOLEAN_FIELDS.map((spec) => (
                  <BooleanSwitchField key={spec.name} spec={spec} control={form.control} />
                ))}
              </div>
              <Button type="submit" className="self-start" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save"}
              </Button>
            </form>
          </Form>
        )}
      </Panel>
      {isMultiProfile ? null : (
        <CommunicationYamlPreview activeProfile={editName} profiles={{ [editName]: values }} />
      )}
    </div>
  );
}

/** Active-profile picker plus the "Activate profile" PUT button. */
function ActivateProfileRow({ settings, api }: CommunicationEditorProps) {
  const [selected, setSelected] = useState<string | null>(settings.activeProfile);

  const activate = async (): Promise<void> => {
    if (selected === null) return;
    try {
      await api.putProfile(selected);
      toast.success(`Profile "${selected}" activated`);
    } catch (reason: unknown) {
      toast.error(`Failed to activate profile: ${describeError(reason)}`);
    }
  };

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Active profile</span>
        <Select value={selected ?? undefined} onValueChange={setSelected}>
          <SelectTrigger size="sm" aria-label="Select profile" className="w-56">
            <SelectValue placeholder="Select a profile" />
          </SelectTrigger>
          <SelectContent>
            {settings.availableProfiles.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" variant="outline" disabled={selected === null} onClick={() => void activate()}>
        Activate profile
      </Button>
    </div>
  );
}

/** One zod-validated enum `<Select>` bound to a react-hook-form field. */
function EnumSelectField({
  spec,
  control,
}: {
  spec: EnumFieldSpec;
  control: ReturnType<typeof useForm<CommunicationForm>>["control"];
}) {
  return (
    <FormField
      control={control}
      name={spec.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{spec.label}</FormLabel>
          <FormControl>
            <Select value={asString(field.value)} onValueChange={field.onChange}>
              <SelectTrigger size="sm" aria-label={spec.label}>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {spec.values.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormControl>
        </FormItem>
      )}
    />
  );
}

/** One zod-validated boolean `<Switch>` bound to a react-hook-form field. */
function BooleanSwitchField({
  spec,
  control,
}: {
  spec: BooleanFieldSpec;
  control: ReturnType<typeof useForm<CommunicationForm>>["control"];
}) {
  return (
    <FormField
      control={control}
      name={spec.name}
      render={({ field }) => (
        <FormItem className="flex flex-row items-center justify-between gap-2">
          <FormLabel>{spec.label}</FormLabel>
          <FormControl>
            <Switch
              aria-label={spec.label}
              checked={field.value === true}
              onCheckedChange={field.onChange}
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

/** Narrow a react-hook-form field value to the string a `<Select>` accepts. */
function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Reduce an unknown thrown reason to a display message. */
function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
