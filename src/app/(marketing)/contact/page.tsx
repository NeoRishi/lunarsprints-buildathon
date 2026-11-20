import type { Metadata } from "next";
import { company } from "../site";
import styles from "../marketing.module.css";

export const metadata: Metadata = { title: "Contact · LunarSprints" };

export default function Contact() {
  const g = company.grievanceOfficer;
  return (
    <article className={styles.legal}>
      <h1>Contact</h1>
      <p>We read every message and usually reply within two working days.</p>

      <section className={styles.card}>
        <h2>Support and questions</h2>
        <p>
          <a href={`mailto:${company.supportEmail}`}>{company.supportEmail}</a>
        </p>
        <p>
          For account or data requests, please write from the email address on
          your account.
        </p>
      </section>

      <section className={styles.card}>
        <h2>Grievance officer</h2>
        <p>
          {g.name}
          <br />
          <a href={`mailto:${g.email}`}>{g.email}</a>
        </p>
        <p>For privacy and data protection concerns.</p>
      </section>

      <section className={styles.card}>
        <h2>Company</h2>
        <p>
          {company.legalName}
          <br />
          {company.address}
        </p>
      </section>
    </article>
  );
}
