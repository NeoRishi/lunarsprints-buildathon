import type { Metadata } from "next";
import Link from "next/link";
import { company } from "../site";
import styles from "../marketing.module.css";

export const metadata: Metadata = { title: "Terms · LunarSprints" };

export default function Terms() {
  return (
    <article className={styles.legal}>
      <h1>Terms of use</h1>
      <p className={styles.updated}>Effective {company.policiesEffective}</p>

      <p>
        These terms are an agreement between you and {company.legalName}{" "}
        (“NeoRishi”, “we”), {company.address}, for your use of LunarSprints. By
        creating an account or using LunarSprints you agree to them.
      </p>

      <h2>The service</h2>
      <p>
        LunarSprints helps you turn an intention into a goal, a set of steps and
        a schedule for a sprint of a few days to several weeks, and to track
        your progress. Some features use AI to suggest wording, steps and
        changes. You decide what to approve; nothing becomes part of your plan
        until you do.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be 18 or older.</li>
        <li>
          Keep your sign-in details safe. You are responsible for activity on
          your account.
        </li>
        <li>Your NeoRishi account works across NeoRishi products.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        What you write in LunarSprints stays yours. You give us permission to
        store and process it only to run the service for you, including sending
        it to the providers listed in our <Link href="/privacy">Privacy</Link>{" "}
        page.
      </p>

      <h2>AI suggestions</h2>
      <p>
        AI suggestions can be wrong or incomplete. They are planning aids, not
        professional, medical, legal or financial advice. Use your own judgement
        and approve only what fits your life. Any traditional calendar or rhythm
        context is cultural information, not a claim about outcomes.
      </p>

      <h2>Fair use</h2>
      <p>Please don’t:</p>
      <ul>
        <li>break the law or infringe anyone’s rights using LunarSprints;</li>
        <li>
          try to access other people’s data, probe or overload the service, or
          get around usage limits;
        </li>
        <li>use automated tools to create accounts or send requests.</li>
      </ul>
      <p>
        Plans have limits, such as how many sprints can be active at once and
        how long a sprint can be. We may suspend accounts that misuse the
        service, and will tell you why unless the law prevents it.
      </p>

      <h2>Plans and payment</h2>
      <p>
        LunarSprints is free to use today. When paid plans are offered, their
        price, what they include, billing and cancellation terms will be shown
        before you pay. See our <Link href="/refunds">Refunds</Link> page.
      </p>

      <h2>Availability and changes</h2>
      <p>
        We work to keep LunarSprints available and your data safe, but the
        service is provided as it is and may sometimes be unavailable. We may
        improve or change features; if a change significantly reduces what you
        can do on a paid plan, we will tell you in advance.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop using LunarSprints at any time and ask us to delete your
        account. We may close accounts that break these terms.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, NeoRishi is not liable for indirect or
        consequential losses, or for decisions you make based on your plans or
        AI suggestions. Nothing in these terms limits rights you have under
        Indian consumer law that cannot be limited.
      </p>

      <h2>Law and disputes</h2>
      <p>
        These terms are governed by the laws of India. Courts in Pune,
        Maharashtra have jurisdiction. Please write to us first; most things can
        be sorted out quickly.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${company.supportEmail}`}>{company.supportEmail}</a>
      </p>
    </article>
  );
}
