package com.englishapp.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Getter
@Setter
@Entity
@Table(name = "sentence_reviews")
public class SentenceReview {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private UserAccount user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sentence_id", nullable = false)
    private Sentence sentence;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "review_session_id")
    private ReviewSession reviewSession;

    @Column(name = "reviewed_at", nullable = false)
    private Instant reviewedAt = Instant.now();
}
