import type { Metadata } from "next";
import Link from "next/link";
import plans from "../../../config/plans.json";
import { MIN_SPRINT_DAYS } from "@/features/lunarsprints/contracts";
import styles from "./marketing.module.css";

export const metadata: Metadata = {
  title: "LunarSprints · Know what matters today",
  description:
    "Say what you want to move this fortnight. LunarSprints turns it into a plan that fits the hours you actually have, and shows you the next step each day.",
};

// An illustration of a 15-day sprint, not live calendar data.
const SAMPLE_DAYS = 15;
const SAMPLE_TODAY = 4;

export default function Landing() {
  return (
    <>
      <section className={styles.hero}>
        <h1>Know what matters today.</h1>
        <p className={styles.lede}>
          Say what you want to move this fortnight. LunarSprints turns it into a
          plan that fits the hours you actually have, and shows you the next
          step each day.
        </p>
        <div className={styles.ctas}>
          <Link href="/app" className={styles.primary}>
            Start your first sprint free
          </Link>
          <Link href="#how" className={styles.secondary}>
            See how it works
          </Link>
        </div>
        <p className={styles.note}>
          Free to use. No card needed. One NeoRishi account.
        </p>
        <div
          className={styles.paksha}
          role="img"
          aria-label={`Illustration: day ${SAMPLE_TODAY} of a ${SAMPLE_DAYS}-day sprint, from new moon to full moon`}
        >
          <div className={styles.dots}>
            {Array.from({ length: SAMPLE_DAYS }, (_, i) => {
              const day = i + 1;
              const cls = [
                styles.dot,
                day < SAMPLE_TODAY ? styles.dotDone : "",
                day === SAMPLE_TODAY ? styles.dotToday : "",
                day === SAMPLE_DAYS ? styles.dotFull : "",
              ].join(" ");
              return <span key={day} className={cls} />;
            })}
          </div>
          <div className={styles.pakshaLabels}>
            <span>Pratipada</span>
            <span>
              Example: day {SAMPLE_TODAY} of {SAMPLE_DAYS}
            </span>
            <span>Purnima</span>
          </div>
        </div>
      </section>

      <section id="how" className={styles.section}>
        <h2>How it works</h2>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <h3>Say what you want to move</h3>
            <p>Speak or type it. Messy is fine; that’s where we start.</p>
          </li>
          <li className={styles.step}>
            <h3>Shape it together</h3>
            <p>
              A few useful questions, one clear goal, and steps checked against
              the time you really have.
            </p>
          </li>
          <li className={styles.step}>
            <h3>Move it daily</h3>
            <p>
              A clear next step each day, and an honest new plan when life
              changes.
            </p>
          </li>
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="promises">
        <h2 id="promises">What you can count on</h2>
        <ul className={styles.promises}>
          <li>
            <strong>Nothing changes without you</strong>
            Every goal, step and date waits for your approval.
          </li>
          <li>
            <strong>Plans that fit real life</strong>
            Your hours, rest days and a buffer for the unexpected are built in.
          </li>
          <li>
            <strong>Finished work stays finished</strong>
            When you adjust the plan, finished steps are never rewritten.
          </li>
          <li>
            <strong>Your sprint, your length</strong>
            {MIN_SPRINT_DAYS} to {plans.free.maxSprintDays} days on the free
            plan, enough for a full paksha. Up to {plans.plus.maxSprintDays}{" "}
            days with LunarSprints+, coming soon.
          </li>
        </ul>
      </section>

      <section id="pricing" className={styles.section}>
        <h2>Pricing</h2>
        <div className={styles.plans}>
          <div className={styles.plan}>
            <h3>Free</h3>
            <p className={styles.price}>₹0</p>
            <ul>
              <li>{plans.free.maxActiveSprints} active sprint at a time</li>
              <li>
                Sprints of {MIN_SPRINT_DAYS} to {plans.free.maxSprintDays} days
              </li>
              <li>AI help to shape your goal and steps</li>
              <li>Voice or text to capture what you want</li>
            </ul>
            <Link href="/app" className={styles.primary}>
              Start free
            </Link>
          </div>
          <div className={`${styles.plan} ${styles.planFeatured}`}>
            <span className={styles.badge}>Coming soon</span>
            <h3>LunarSprints+</h3>
            <p className={styles.price}>
              ₹299 <small>/ month</small>
            </p>
            <ul>
              <li>Up to {plans.plus.maxActiveSprints} sprints at once</li>
              <li>Sprints of up to {plans.plus.maxSprintDays} days</li>
              <li>More AI planning and replanning each month</li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
