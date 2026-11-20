import type { Metadata } from "next";
import { company } from "../site";
import styles from "../marketing.module.css";

export const metadata: Metadata = {
  title: "Refunds and cancellation · LunarSprints",
};

export default function Refunds() {
  return (
    <article className={styles.legal}>
      <h1>Refunds and cancellation</h1>
      <p className={styles.updated}>Effective {company.policiesEffective}</p>

      <p>
        LunarSprints is free to use today. There are no paid plans yet, so
        nothing is charged and there is nothing to refund.
      </p>
      <p>
        Before we offer a paid plan, we will publish its cancellation and refund
        terms on this page, and show them to you before you pay. Existing free
        accounts will not be moved to a paid plan without your explicit choice.
      </p>
      <p>
        Questions:{" "}
        <a href={`mailto:${company.supportEmail}`}>{company.supportEmail}</a>
      </p>
    </article>
  );
}
