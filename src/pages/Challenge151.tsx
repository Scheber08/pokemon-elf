import { useEffect } from 'react';
import { HowItWorks, RunSetup, StatCards } from '../components/ChallengeParts';
import { OnlineNote, RunBoard, RunModeBadge, RunNotice } from '../components/RunBoard';
import { Segmented } from '../components/Segmented';
import { SeasonResultView } from '../components/SeasonResultView';
import { MODE_RULES } from '../lib/challengeEngine';
import { useSettings } from '../state/Settings';
import { useChallengeRun } from '../state/useChallengeRun';
import type { ChallengeKey, SpriteStyle } from '../types';

type Mode151 = 'c151' | 'retro340';
const MODES: readonly ChallengeKey[] = ['c151', 'retro340'];

const HOW_TO: Record<Mode151, string> = {
  c151: 'Jede Runde würfelt ein zufälliges Pokémon aus den Original-151. Setze es auf einen beliebigen freien Platz, fülle alle 11 und spiel dann eine Saison mit 34 Spielen. Schaffst du 34–0?',
  retro340:
    'Retro-Look, Gen-1-Skalierung: Jede Runde würfelt einen Typ. Wähle ein passendes Pokémon aus den Original-151 und setze es auf einen freien Platz, mit höchstens 2 Legendären. Fülle alle 11 Plätze und spiel eine Saison mit 34 Spielen. Schaffst du 34–0?',
};

export function Challenge151() {
  const settings = useSettings();
  const run = useChallengeRun('c151', { challenge: 'c151', allowed: MODES });
  const { phase, result, markRevealed } = run;
  const mode: Mode151 = run.challenge === 'retro340' ? 'retro340' : 'c151';
  const sprite: SpriteStyle = mode === 'retro340' ? 'retro' : settings.sprite;

  // Ticker nur direkt nach dem Run – nach einem Reload kommt gleich die Bilanz.
  useEffect(() => {
    if (phase === 'result' && result?.reveal) markRevealed();
  }, [phase, result?.reveal, markRevealed]);

  const onFinish = async () => {
    if (await run.finish()) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (phase === 'result' && result) {
    return (
      <div className="page">
        <SeasonResultView
          challenge={result.challenge}
          input={result.input}
          scaleKind={MODE_RULES[result.challenge].scale}
          sprite={result.challenge === 'retro340' ? 'retro' : settings.sprite}
          entryId={result.localEntryId}
          ranking={result.ranking}
          reveal={result.reveal}
          onNewRun={run.reset}
          stats={run.stats}
        />
      </div>
    );
  }

  return (
    <div className={`page challenge ${mode === 'retro340' ? 'challenge--retro' : ''}`}>
      <header className="page-head">
        <h1 className="page-title">{mode === 'c151' ? '151 Challenge' : 'Retro 34–0'}</h1>
        <p className="page-lead">Nur die Original-151. Eigene Gen-1-Skalierung, eigene Rangliste.</p>
      </header>

      {phase === 'play' && run.engine ? (
        <RunBoard
          state={run.engine}
          data={run.data}
          sprite={sprite}
          onReroll={run.reroll}
          onPlace={run.place}
          onFinish={() => void onFinish()}
          finishing={run.finishing}
          onFinishOffline={run.canFinishOffline ? () => void run.finish({ offline: true }) : undefined}
          onAbort={run.reset}
          statusExtra={<RunModeBadge online={run.online} />}
          notice={
            <>
              {run.notice && <RunNotice onClose={run.clearNotice}>{run.notice}</RunNotice>}
              {run.error && (
                <RunNotice error onClose={run.clearError}>
                  {run.error}
                </RunNotice>
              )}
            </>
          }
        />
      ) : (
        <div className="challenge__setup">
          <div>
            <HowItWorks>{HOW_TO[mode]}</HowItWorks>
            <StatCards stats={run.stats} />
          </div>
          <RunSetup
            formation={run.setup.formation}
            ssEnabled={run.setup.ssEnabled}
            teamName={run.setup.teamName}
            onChange={run.setSetup}
            onStart={() => void run.start()}
            starting={run.starting}
            extra={
              <Segmented<Mode151>
                label="Modus"
                value={mode}
                onChange={(challenge) => run.setSetup({ challenge })}
                options={[
                  { value: 'c151', label: '151 Challenge' },
                  { value: 'retro340', label: 'Retro 34–0' },
                ]}
              />
            }
            note={
              <>
                {run.error && <RunNotice error>{run.error}</RunNotice>}
                <OnlineNote online={run.apiOnline} />
              </>
            }
          />
        </div>
      )}
    </div>
  );
}
