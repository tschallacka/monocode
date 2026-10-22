import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadSkills,
  SKILLS_CHANGE_EVENT,
  hasNativeCommands,
  subscribeSkills,
  mergeCatalog,
  peekSkills,
  skillCatalogKey,
  type Skill,
  type SkillCatalogContext,
} from "../../skills/model/skills";
import type { HarnessId } from "../model/session";
import type { ModCommand } from "../../mods/model/modHost";
import { useModHost } from "../../mods/model/useModHost";

export type ComposerSkillContextToken = {
  key: string;
  generation: number;
};

type ComposerSkillState = {
  key: string;
  skills: Skill[];
};

export function nextComposerSkillContextToken(
  current: ComposerSkillContextToken | null,
  key: string,
): ComposerSkillContextToken {
  if (current?.key === key) return current;
  return { key, generation: (current?.generation ?? -1) + 1 };
}

export function pickerSkillLoadOptions(
  harness: HarnessId,
): { refresh: true } | undefined {
  return hasNativeCommands(harness) ? undefined : { refresh: true };
}

export function visibleComposerSkills(
  state: ComposerSkillState,
  currentKey: string,
  cached: Skill[] | null,
  fallback: Skill[],
): Skill[] {
  return state.key === currentKey ? state.skills : (cached ?? fallback);
}

export function useComposerSkills(input: {
  harness: HarnessId;
  executionCwd: string;
  sessionId?: string;
  pickerOpen: boolean;
}) {
  const context = useMemo<SkillCatalogContext>(
    () => ({
      harness: input.harness,
      cwd: input.executionCwd,
      sessionId: input.sessionId,
    }),
    [input.executionCwd, input.harness, input.sessionId],
  );
  const contextKey = skillCatalogKey(context);
  const fallback = useMemo<Skill[]>(
    () => (hasNativeCommands(input.harness) ? [] : mergeCatalog([])),
    [input.harness],
  );
  const currentToken = useRef<ComposerSkillContextToken | null>(null);
  currentToken.current = nextComposerSkillContextToken(
    currentToken.current,
    contextKey,
  );
  const contextToken = currentToken.current;
  const [state, setState] = useState<ComposerSkillState>(() => ({
    key: contextKey,
    skills: peekSkills(context) ?? fallback,
  }));

  const isCurrent = useCallback(
    (token: ComposerSkillContextToken) => currentToken.current === token,
    [],
  );
  const commit = useCallback(
    (token: ComposerSkillContextToken, skills: Skill[]) => {
      if (!isCurrent(token)) return false;
      setState({ key: token.key, skills });
      return true;
    },
    [isCurrent],
  );
  const refresh = useCallback(
    async (options?: { refresh?: boolean }) => {
      const token = contextToken;
      const next = await loadSkills(context, options);
      return commit(token, next);
    },
    [commit, context, contextToken],
  );

  useEffect(() => {
    return subscribeSkills(context, (skills) => commit(contextToken, skills));
  }, [commit, context, contextToken]);

  useEffect(() => {
    const cached = peekSkills(context);
    if (cached) commit(contextToken, cached);
    void refresh().catch(() => undefined);
  }, [commit, context, contextToken, refresh]);

  useEffect(() => {
    const onChange = (): void => {
      if (!hasNativeCommands(context.harness)) void refresh({ refresh: true });
    };
    window.addEventListener(SKILLS_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(SKILLS_CHANGE_EVENT, onChange);
  }, [context.harness, refresh]);

  useEffect(() => {
    if (!input.pickerOpen) return;
    void refresh(pickerSkillLoadOptions(input.harness)).catch(() => undefined);
  }, [input.harness, input.pickerOpen, refresh]);

  const { commands } = useModHost(
    input.harness === "claude" ? input.sessionId : undefined,
  );
  const visible = visibleComposerSkills(
    state,
    contextKey,
    peekSkills(context),
    fallback,
  );
  const skills = useMemo(
    () => withModCommands(visible, commands),
    [visible, commands],
  );

  return {
    contextKey,
    contextToken,
    isCurrent,
    refresh,
    skills,
  };
}

/**
 * The session's mod commands lead the picker; Claude runs them itself, so a
 * file skill of the same name gives way rather than shadow one.
 */
export function withModCommands(
  skills: Skill[],
  commands: ModCommand[],
): Skill[] {
  if (commands.length === 0) return skills;
  const names = new Set(commands.map((command) => command.name));
  return [
    ...commands.map(
      (command): Skill => ({
        kind: "native",
        name: command.name,
        description: command.description,
        invocation: command.name,
        source: "claude",
        origin: command.plugin,
        ...(command.argumentHint ? { inputHint: command.argumentHint } : {}),
      }),
    ),
    ...skills.filter((skill) => !names.has(skill.name)),
  ];
}
