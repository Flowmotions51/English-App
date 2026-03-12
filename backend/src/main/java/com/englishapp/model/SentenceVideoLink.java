package com.englishapp.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Getter
@Setter
@Entity
@Table(name = "sentence_video_links")
public class SentenceVideoLink {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sentence_id", nullable = false)
    private Sentence sentence;

    @Column(name = "url", nullable = false, length = 2048)
    private String url;

    /** Start time in seconds (e.g. for YouTube ?t=83). Null if not specified. */
    @Column(name = "time_code_seconds")
    private Integer timeCodeSeconds;

    @Column(name = "label", length = 255)
    private String label;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
