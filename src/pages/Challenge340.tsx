import { useEffect } from 'react';
import { HowItWorks, RunSetup, StatCards } from '../components/ChallengeParts';
import { OnlineNote, RunBoard, RunModeBadge, RunNotice } from '../components/RunBoard';
import { SeasonResultView } from '../components/SeasonResultView';
import { MODE_RULES } from '../lib/challengeEngine';
import { useSettings } from '../state/Settings';
import { useChallengeRun } from '../state/useChallengeRun';

export function Challenge340() {
  const { sprite } = useSettings();
  const run = useChallengeRun('c340');
  const { phase, result, markRevealed } = run;

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
          sprite={sprite}
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
    <div className="page challenge">
      <header className="page-head">
        <h1 className="page-title">34–0 Challenge</h1>
        <p className="page-lead">Alle 1.025 Pokémon. Schaffst du 34–0?</p>
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
            <HowItWorks>
              Jede Runde würfelt eine Region und einen Typ. Setze ein passendes Pokémon auf einen freien Platz, mit
              höchstens 2 Legendären. Fülle alle 11 Plätze und spiel dann eine Saison mit 34 Spielen. Schaffst du 34–0?
            </HowItWorks>
            <StatCards stats={run.stats} />
          </div>
          <RunSetup
            formation={run.setup.formation}
            ssEnabled={run.setup.ssEnabled}
            teamName={run.setup.teamName}
            onChange={run.setSetup}
            onStart={() => void run.start()}
            starting={run.starting}
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
