import type { Metadata } from "next";
import { company } from "../site";
import styles from "../marketing.module.css";

export const metadata: Metadata = { title: "Privacy · LunarSprints" };

export default function Privacy() {
  const g = company.grievanceOfficer;
  return (
    <article className={styles.legal}>
      <h1>Privacy</h1>
      <p className={styles.updated}>Effective {company.policiesEffective}</p>

      <p>
        LunarSprints is a product of {company.legalName} (“NeoRishi”, “we”),{" "}
        {company.address}. This page explains what we collect when you use
        LunarSprints, why, who helps us process it, and the choices you have. We
        wrote it in plain language; if anything is unclear, write to{" "}
        <a href={`mailto:${company.supportEmail}`}>{company.supportEmail}</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> your email address and, if you sign
          in with Google, the basic profile Google shares (name and email). Your
          NeoRishi account is shared across NeoRishi products.
        </li>
        <li>
          <strong>What you write in your sprints:</strong> your intentions,
          answers to planning questions, goals, steps, dates, available time,
          progress reports and notes.
        </li>
        <li>
          <strong>Voice recordings, only if you choose to record:</strong> the
          recording is sent for transcription and is not stored by us. The
          resulting text is saved like anything you type, and you can edit it
          first.
        </li>
        <li>
          <strong>Technical records:</strong> sign-in cookies that keep you
          logged in, basic request logs, and usage counts for AI requests (such
          as timing and token counts, without the content) so we can keep the
          service reliable and affordable.
        </li>
      </ul>
      <p>
        We do not use advertising trackers or sell your data. We do not ask for
        your date, time or place of birth.
      </p>

      <h2>Why we use it</h2>
      <ul>
        <li>To create your account and keep you signed in.</li>
        <li>
          To turn what you write into a goal, steps and a schedule, and to keep
          your plan and its history.
        </li>
        <li>
          To send account emails you need, such as sign-up confirmation and
          password reset.
        </li>
        <li>To prevent abuse, fix problems and control costs.</li>
      </ul>
      <p>
        We process your personal data on the basis of your consent, which you
        give when you create an account and use LunarSprints, as described in
        India’s Digital Personal Data Protection Act, 2023. You can withdraw
        consent at any time by asking us to delete your account.
      </p>

      <h2>Who helps us process it</h2>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>What it does for us</th>
              <th>Where</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Supabase</td>
              <td>
                Accounts, sign-in and the database that stores your sprints
              </td>
              <td>Tokyo, Japan</td>
            </tr>
            <tr>
              <td>OpenAI</td>
              <td>
                AI suggestions for goals, steps and replans, and voice
                transcription
              </td>
              <td>United States</td>
            </tr>
            <tr>
              <td>Vercel</td>
              <td>Hosting the website and app</td>
              <td>Tokyo, Japan, with a global network</td>
            </tr>
            <tr>
              <td>Resend</td>
              <td>Delivering account emails</td>
              <td>United States</td>
            </tr>
            <tr>
              <td>Google</td>
              <td>Sign-in with Google, if you choose it</td>
              <td>Global</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        This means your data is processed outside India. Each provider handles
        it under its own terms and only to deliver its part of the service.
        OpenAI’s API terms state that data sent through its API is not used to
        train its models by default.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your account and sprints for as long as your account is open, so
        you can return to them. Each saved change is kept as part of your
        sprint’s history. Archiving a sprint hides it from your workspace but
        does not erase it. To erase your data, ask us to delete your account
        (see below); we will delete your sprints and their history within 30
        days, except where the law requires us to keep a record.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li>Ask what personal data we hold about you and how we use it.</li>
        <li>Ask us to correct or complete it.</li>
        <li>Ask us to erase it and close your account.</li>
        <li>Withdraw your consent.</li>
        <li>
          Nominate someone to exercise these rights for you if you are unable
          to.
        </li>
        <li>
          Raise a grievance with us, and then with the Data Protection Board of
          India if it is not resolved.
        </li>
      </ul>
      <p>
        You can download a copy of any sprint from inside the app at any time.
        For everything else, write to{" "}
        <a href={`mailto:${company.supportEmail}`}>{company.supportEmail}</a>{" "}
        from the email address on your account.
      </p>

      <h2>Grievance officer</h2>
      <p>
        {g.name}
        <br />
        <a href={`mailto:${g.email}`}>{g.email}</a>
        <br />
        {company.legalName}, {company.address}
      </p>
      <p>We aim to acknowledge every grievance within 7 days.</p>

      <h2>Age</h2>
      <p>
        LunarSprints is meant for people aged 18 and over. Please do not create
        an account if you are younger.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, each person can read only their own
        sprints, and sign-in cookies cannot be read by page scripts. No system
        is perfectly secure; if we learn of a breach that affects you, we will
        tell you and the authorities as the law requires.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy in a way that matters, we will update the date
        above and tell you in the app or by email before the change applies.
      </p>
    </article>
  );
}
